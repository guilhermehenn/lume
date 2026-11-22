"""Bancos: nome sem espaços sobrando e sem repetir, código COMPE, limites do cofre e exclusão
como junção (lançamentos, saldo inicial e principal indo para outro banco numa gravação só)."""

import sqlite3
import time

import pytest
from test_vaults import NOW, bank, inv, new_vault, state, tx

from app.vaults import models, registry, service


def _changes(base, upserts=None, deletes=None):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}}


def _fails(session, upserts=None, deletes=None, base=1) -> str:
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(base, upserts, deletes))
    assert err.value.code == "invalid"
    return str(err.value)


def _banks(session) -> dict[str, dict]:
    return {b["id"]: b for b in service.load_data(session)["data"]["banks"]}


# ---------------------------------------------------------------- nome e código


def test_nome_sem_espacos_sobrando_e_nome_vazio_recusado():
    session = new_vault()
    service.apply_changes(session, _changes(1, {"banks": [bank("b2", name="  Itaú  ")]}))
    assert _banks(session)["b2"]["name"] == "Itaú"
    assert "name" in _fails(session, {"banks": [bank("b3", name="   ")]}, base=2)


@pytest.mark.parametrize("code", ["1", "12", "1234", "abc", "0a1"])
def test_codigo_com_tamanho_errado_e_recusado(code):
    session = new_vault()
    assert "banks" in _fails(session, {"banks": [bank("b2", name="Itaú", code=code)]})


@pytest.mark.parametrize("code", ["001", "341", None])
def test_codigo_com_3_digitos_ou_sem_codigo_passa(code):
    session = new_vault()
    service.apply_changes(session, _changes(1, {"banks": [bank("b2", name="Itaú", code=code)]}))
    assert _banks(session)["b2"].get("code") == code


def test_cofre_antigo_com_codigo_curto_ainda_abre():
    session = new_vault(data=state(banks=[bank(code="1")]))
    assert _banks(session)["b1"]["code"] == "1"


# ---------------------------------------------------------------- nomes repetidos


@pytest.mark.parametrize("name", ["Nubank", "nubank", "NUBANK", "  Nubank ", "Nubánk"])
def test_nome_repetido_e_recusado(name):
    session = new_vault()
    assert "já existe" in _fails(session, {"banks": [bank("b2", name=name)]})


def test_espaco_no_meio_faz_outro_nome():
    session = new_vault()
    service.apply_changes(session, _changes(1, {"banks": [bank("b2", name="Nu bank")]}))
    assert _banks(session)["b2"]["name"] == "Nu bank"


def test_dois_bancos_novos_com_o_mesmo_nome_no_mesmo_lote():
    session = new_vault()
    upserts = {"banks": [bank("b2", name="Itaú"), bank("b3", name="ITAU")]}
    assert "já existe" in _fails(session, upserts)


def test_renomear_para_o_nome_de_outro_banco_e_recusado_mas_trocar_os_nomes_vale():
    session = new_vault(data=state(banks=[bank(), bank("b2", name="Itaú")]))
    assert "já existe" in _fails(session, {"banks": [bank("b2", name="nubank")]})
    # Trocar os nomes entre dois bancos numa gravação só não deixa nome repetido.
    swap = {"banks": [bank("b1", name="Itaú"), bank("b2", name="Nubank")]}
    service.apply_changes(session, _changes(1, swap))
    assert {b["id"]: b["name"] for b in _banks(session).values()} == {"b1": "Itaú", "b2": "Nubank"}


def test_excluir_um_e_criar_outro_com_o_mesmo_nome_no_mesmo_lote():
    session = new_vault(data=state(transactions=[], investments=[]))
    service.apply_changes(
        session, _changes(1, {"banks": [bank("b2", name="Nubank")]}, {"banks": ["b1"]})
    )
    assert list(_banks(session)) == ["b2"]


def test_cofre_antigo_com_nomes_repetidos_continua_editavel():
    """Repetição vinda de versões anteriores não trava a edição; só não deixa criar outra."""
    session = new_vault(data=state(banks=[bank(), bank("b2")]))
    service.apply_changes(session, _changes(1, {"banks": [bank("b2", color="#000000")]}))
    assert _banks(session)["b2"]["color"] == "#000000"
    assert "já existe" in _fails(session, {"banks": [bank("b3")]}, base=2)


def test_chave_do_nome_igual_a_do_navegador():
    assert models.text_key("  Itaú  Unibanco ") == "itau unibanco"
    assert models.text_key("ÇAIXA") == models.text_key("caixa")


# ---------------------------------------------------------------- limites


def test_limite_de_bancos_vale_ao_gravar():
    """Um cofre com mais bancos do que o backup aceita não poderia ser restaurado depois."""
    limit = models.MAX_ITEMS["banks"]
    many = [bank(f"b{i}", name=f"Banco {i}") for i in range(2, limit + 1)]
    session = new_vault()
    service.apply_changes(session, _changes(1, {"banks": many}))
    assert len(_banks(session)) == limit
    message = _fails(session, {"banks": [bank("extra", name="Banco extra")]}, base=2)
    assert f"passaria de {limit}" in message
    # Editar um dos que já existem continua valendo.
    service.apply_changes(session, _changes(2, {"banks": [bank("b2", name="Banco 2b")]}))


def test_limites_iguais_aos_do_backup():
    for name, limit in models.MAX_ITEMS.items():
        field = models.DataState.model_fields[name]
        assert any(getattr(m, "max_length", None) == limit for m in field.metadata), name


# ---------------------------------------------------------------- exclusão como junção


def _merge_state(count=3):
    banks = [
        bank(isPrimary=True, initialBalance=450000),
        bank("b2", name="Itaú", initialBalance=10000),
    ]
    txs = [tx(f"t{i}", bankId="b1" if i % 2 else "b2") for i in range(count)]
    return state(banks=banks, transactions=txs, investments=[inv(bankId="b1")])


def _total(path) -> int:
    """Saldo total calculado direto no arquivo (como o app calcula)."""
    with sqlite3.connect(path) as conn:
        return conn.execute(
            "SELECT (SELECT COALESCE(SUM(initial_balance), 0) FROM banks)"
            " + (SELECT COALESCE(SUM(CASE kind WHEN 'income' THEN amount ELSE -amount END), 0)"
            " FROM transactions)"
            " + (SELECT COALESCE(SUM(CASE operation WHEN 'contribution' THEN -amount"
            " ELSE amount END), 0) FROM investments)"
        ).fetchone()[0]


def _merge_payload(session, base=1):
    data = service.load_data(session)["data"]
    moved_tx = [
        {**t, "bankId": "b2", "updatedAt": NOW} for t in data["transactions"] if t["bankId"] == "b1"
    ]
    moved_inv = [{**i, "bankId": "b2"} for i in data["investments"] if i["bankId"] == "b1"]
    target = {**_banks(session)["b2"], "initialBalance": 460000, "isPrimary": True}
    return _changes(
        base,
        {"banks": [target], "transactions": moved_tx, "investments": moved_inv},
        {"banks": ["b1"]},
    )


def test_excluir_banco_principal_movendo_tudo_numa_gravacao_so():
    """O que o app manda ao excluir: banco sai, lançamentos e principal vão para o destino."""
    session = new_vault(data=_merge_state())
    path = registry.path_for(session.vault_id)
    before = _total(path)
    service.apply_changes(session, _merge_payload(session))
    banks = _banks(session)
    assert list(banks) == ["b2"]
    assert banks["b2"]["isPrimary"] is True
    assert _total(path) == before
    data = service.load_data(session)["data"]
    assert {t["bankId"] for t in data["transactions"]} == {"b2"}


def test_juncao_pela_metade_e_recusada_e_nada_muda():
    """Sem mover todos os lançamentos, a exclusão é recusada inteira (nem o destino muda)."""
    session = new_vault(data=_merge_state())
    payload = _merge_payload(session)
    payload["upserts"]["transactions"] = payload["upserts"]["transactions"][:-1]
    assert "ainda tem lançamentos" in _fails(session, payload["upserts"], payload["deletes"])
    assert _banks(session)["b2"]["initialBalance"] == 10000
    assert service.load_data(session)["revision"] == 1


def test_juncao_com_20_mil_lancamentos():
    session = new_vault(data=_merge_state(count=40_000))
    path = registry.path_for(session.vault_id)
    before = _total(path)
    payload = _merge_payload(session)
    assert len(payload["upserts"]["transactions"]) == 20_000
    started = time.perf_counter()
    service.apply_changes(session, payload)
    elapsed = time.perf_counter() - started
    print(f"\n  excluir banco movendo 20 mil lançamentos: {elapsed * 1000:.0f} ms")
    assert _total(path) == before
    assert elapsed < 5


def test_categoria_do_lancamento_movido_continua_conferida():
    """Mover lançamentos não abre brecha: categoria de outro tipo continua recusada."""
    session = new_vault(data=_merge_state())
    payload = _merge_payload(session)
    payload["upserts"]["transactions"][0]["categoryId"] = "c2"
    assert "categoria de outro tipo" in _fails(session, payload["upserts"], payload["deletes"])
