"""Categorias: nome (ou chave do catálogo) obrigatório e sem repetir no mesmo tipo, exclusão
movendo os lançamentos numa gravação só, índices usados nas conferências e o lote de
restauração (backup e "Desfazer"), que volta os dados como eram."""

import re
import sqlite3
import time
from pathlib import Path

import pytest
from test_vaults import NOW, bank, category, inv, new_vault, state, tx

from app.vaults import models, registry, service

CATALOG = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "catalog.ts"


def _changes(base, upserts=None, deletes=None, **extra):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}, **extra}


def _fails(session, upserts=None, deletes=None, base=1, **extra) -> str:
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(base, upserts, deletes, **extra))
    assert err.value.code == "invalid"
    return str(err.value)


def _categories(session) -> dict[str, dict]:
    return {c["id"]: c for c in service.load_data(session)["data"]["categories"]}


def _custom(id_, name, kind="expense"):
    return category(id_, kind, nameKey=None, name=name, icon="tag")


# ---------------------------------------------------------------- nome


def test_nome_sem_espacos_sobrando():
    session = new_vault()
    service.apply_changes(session, _changes(1, {"categories": [_custom("c9", "  Academia  ")]}))
    assert _categories(session)["c9"]["name"] == "Academia"


@pytest.mark.parametrize("name", [None, "", "   "])
def test_categoria_sem_nome_e_sem_chave_e_recusada(name):
    session = new_vault()
    assert "sem nome" in _fails(session, {"categories": [_custom("c9", name)]})


def test_chave_do_catalogo_desconhecida_e_recusada():
    session = new_vault()
    item = category("c9", nameKey="nao_existe")
    assert "desconhecida" in _fails(session, {"categories": [item]})


def test_chaves_do_catalogo_iguais_as_do_app():
    text = CATALOG.read_text(encoding="utf-8")
    start = text.index("export const CATEGORY_CATALOG")
    block = text[start : text.index("\n]", start)]
    assert set(re.findall(r"key: '([a-z_]+)'", block)) == models.CATEGORY_KEYS


# ---------------------------------------------------------------- nomes repetidos


@pytest.mark.parametrize("name", ["Academia", "academia", "ACADÊMIA", " Academia "])
def test_nome_repetido_no_mesmo_tipo_e_recusado(name):
    session = new_vault(data=state(categories=[category(), _custom("c9", "Academia")]))
    assert "já existe" in _fails(session, {"categories": [_custom("c10", name)]})


def test_mesmo_nome_em_outro_tipo_vale():
    session = new_vault(data=state(categories=[category(), _custom("c9", "Outros")]))
    service.apply_changes(
        session, _changes(1, {"categories": [_custom("c10", "Outros", kind="income")]})
    )
    assert _categories(session)["c10"]["kind"] == "income"


def test_mesma_chave_do_catalogo_duas_vezes_e_recusada():
    session = new_vault()
    assert "já existe" in _fails(session, {"categories": [category("c9")]})


def test_cofre_antigo_com_repetidas_continua_editavel():
    legacy = state(categories=[category(), _custom("c9", "Academia"), _custom("c10", "academia")])
    session = new_vault(data=legacy)
    service.apply_changes(
        session, _changes(1, {"categories": [{**_custom("c10", "academia"), "color": "#000000"}]})
    )
    assert _categories(session)["c10"]["color"] == "#000000"


def test_trocar_nomes_e_excluir_e_criar_no_mesmo_lote():
    session = new_vault(
        data=state(categories=[category(), _custom("c9", "A"), _custom("c10", "B")])
    )
    swap = {"categories": [_custom("c9", "B"), _custom("c10", "A")]}
    service.apply_changes(session, _changes(1, swap))
    service.apply_changes(
        session, _changes(2, {"categories": [_custom("c11", "A")]}, {"categories": ["c10"]})
    )
    assert {c["name"] for c in _categories(session).values() if c.get("name")} == {"A", "B"}


# ---------------------------------------------------------------- exclusão movendo lançamentos


def _move_state(count=3):
    cats = [category(), category("c2", nameKey="other_expense", icon="ellipsis")]
    return state(categories=cats, transactions=[tx(f"t{i}") for i in range(count)], investments=[])


def _move_payload(session, base=1):
    data = service.load_data(session)["data"]
    moved = [{**t, "categoryId": "c2", "updatedAt": NOW} for t in data["transactions"]]
    return _changes(base, {"transactions": moved}, {"categories": ["c1"]})


def test_excluir_movendo_os_lancamentos_numa_gravacao_so():
    session = new_vault(data=_move_state())
    service.apply_changes(session, _move_payload(session))
    data = service.load_data(session)["data"]
    assert list(_categories(session)) == ["c2"]
    assert {t["categoryId"] for t in data["transactions"]} == {"c2"}


def test_exclusao_pela_metade_e_recusada_e_nada_muda():
    session = new_vault(data=_move_state())
    payload = _move_payload(session)
    payload["upserts"]["transactions"] = payload["upserts"]["transactions"][:-1]
    assert "ainda tem lançamentos" in _fails(session, payload["upserts"], payload["deletes"])
    assert service.load_data(session)["revision"] == 1


def test_mover_para_categoria_de_outro_tipo_e_recusado():
    cats = [category(), category("c2", "income", nameKey="salary")]
    session = new_vault(data=state(categories=cats, investments=[]))
    moved = [{**tx(), "categoryId": "c2"}]
    deletes = {"categories": ["c1"]}
    assert "outro tipo" in _fails(session, {"transactions": moved}, deletes)


def test_excluir_movendo_20_mil_lancamentos():
    session = new_vault(data=_move_state(count=20_000))
    payload = _move_payload(session)
    started = time.perf_counter()
    service.apply_changes(session, payload)
    elapsed = time.perf_counter() - started
    print(f"\n  excluir categoria movendo 20 mil lançamentos: {elapsed * 1000:.0f} ms")
    assert elapsed < 5


def test_conferencias_de_categoria_usam_o_indice():
    """Excluir ou mudar o tipo de uma categoria confere os lançamentos pelo índice, sem varrer."""
    session = new_vault()
    with sqlite3.connect(registry.path_for(session.vault_id)) as conn:
        plans = [
            " ".join(row[3] for row in conn.execute(f"EXPLAIN QUERY PLAN {sql}", ('["c1"]',)))
            for sql in (
                "SELECT 1 FROM transactions WHERE category_id IN (SELECT value FROM json_each(?))",
                "SELECT 1 FROM transactions t JOIN categories c ON c.id = t.category_id"
                " WHERE c.id IN (SELECT value FROM json_each(?)) AND c.kind <> t.kind",
            )
        ]
    assert all("ix_transactions_category" in plan for plan in plans), plans


# ---------------------------------------------------------------- restauração


def _legacy_upserts():
    """O que versões anteriores do app gravavam e as regras de hoje não aceitariam digitado."""
    return {
        "banks": [bank("b2", name="nubank", code="1")],
        "categories": [_custom("c9", "Mercado"), _custom("c10", "mercado")],
        "investments": [inv("i9", fees=400_000)],
    }


def test_lote_de_restauracao_volta_os_dados_como_eram():
    session = new_vault()
    upserts = _legacy_upserts()
    _fails(session, upserts)  # digitado agora: recusado
    service.apply_changes(session, _changes(1, upserts, restore=True))
    data = service.load_data(session)["data"]
    assert {b["id"]: b.get("code") for b in data["banks"]}["b2"] == "1"
    assert any(i["id"] == "i9" for i in data["investments"])


def test_restauracao_nao_dispensa_a_integridade():
    """Banco ou categoria que não existe, tipo trocado e tetos continuam valendo."""
    session = new_vault()
    assert "não existe" in _fails(session, {"transactions": [tx("n", bankId="nada")]}, restore=True)
    item = {"transactions": [tx("n", categoryId="c2")]}
    assert "outro tipo" in _fails(session, item, restore=True)
    many = [_custom(f"x{i}", f"Cat {i}") for i in range(models.MAX_ITEMS["categories"])]
    assert "passaria de" in _fails(session, {"categories": many}, restore=True)
