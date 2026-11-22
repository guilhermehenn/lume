"""Relatórios salvos: período relativo, período em ordem, filtros sem repetição e só com bancos e
categorias que existem, nome sem repetir, tetos, ida e volta dos filtros e o lote de restauração."""

import time

import pytest
from test_vaults import NOW, bank, category, new_vault

from app.vaults import models, service


def _changes(base, upserts=None, deletes=None, **extra):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}, **extra}


def _fails(session, upserts=None, deletes=None, base=1, **extra) -> str:
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(base, upserts, deletes, **extra))
    assert err.value.code == "invalid"
    return str(err.value)


def report(id_="r1", name="Gastos do mês", **filters):
    return {
        "id": id_,
        "name": name,
        "filters": {"kinds": [], "categoryIds": [], "bankIds": [], **filters},
        "groupBy": "category",
        "createdAt": NOW,
    }


def _reports(session) -> dict[str, dict]:
    return {r["id"]: r for r in service.load_data(session)["data"]["reports"]}


# ---------------------------------------------------------------- período


@pytest.mark.parametrize(
    "preset", ["thisMonth", "lastMonth", "last3", "last12", "thisYear", "lastYear"]
)
def test_periodo_relativo_vai_e_volta(preset):
    session = new_vault()
    item = report(**{"from": "2026-11-01", "to": "2026-11-30", "preset": preset})
    service.apply_changes(session, _changes(1, {"reports": [item]}))
    assert _reports(session)["r1"]["filters"]["preset"] == preset


def test_periodo_relativo_desconhecido_e_recusado():
    session = new_vault()
    assert "preset" in _fails(session, {"reports": [report(preset="nextYear")]})


def test_periodo_que_comeca_depois_de_terminar_e_recusado():
    session = new_vault()
    item = report(**{"from": "2026-12-01", "to": "2026-11-01"})
    assert "começa depois" in _fails(session, {"reports": [item]})


def test_relatorio_antigo_sem_periodo_relativo_continua_valendo():
    session = new_vault()
    item = report(**{"from": "2026-03-01", "to": "2026-03-31"})
    service.apply_changes(session, _changes(1, {"reports": [item]}))
    assert "preset" not in _reports(session)["r1"]["filters"]


# ---------------------------------------------------------------- filtros


@pytest.mark.parametrize(
    "filters",
    [{"kinds": ["expense", "expense"]}, {"bankIds": ["b1", "b1"]}, {"categoryIds": ["c1", "c1"]}],
)
def test_filtro_com_repeticao_e_recusado(filters):
    session = new_vault()
    assert "repetidos" in _fails(session, {"reports": [report(**filters)]})


@pytest.mark.parametrize(
    ("filters", "what"),
    [({"bankIds": ["nada"]}, "banco"), ({"categoryIds": ["nada"]}, "categoria")],
)
def test_filtro_com_banco_ou_categoria_que_nao_existe_e_recusado(filters, what):
    session = new_vault()
    assert f"{what} que não existe" in _fails(session, {"reports": [report(**filters)]})


def test_excluir_banco_e_ajustar_o_relatorio_na_mesma_gravacao():
    """O que o app manda ao excluir um banco: o relatório passa a filtrar o destino."""
    banks = [bank(), bank("b2", name="Itaú")]
    session = new_vault(data={**_state(banks=banks), "transactions": [], "investments": []})
    service.apply_changes(session, _changes(1, {"reports": [report(bankIds=["b1"])]}))
    moved = report(bankIds=["b2"])
    service.apply_changes(session, _changes(2, {"reports": [moved]}, {"banks": ["b1"]}))
    assert _reports(session)["r1"]["filters"]["bankIds"] == ["b2"]
    # Sem ajustar o relatório, ele ficaria apontando para o banco que saiu: recusado.
    service.apply_changes(session, _changes(3, {"reports": [report(bankIds=["b2"])]}))
    stale = report(bankIds=["b2"])
    assert "banco que não existe" in _fails(
        session, {"reports": [stale]}, {"banks": ["b2"]}, base=4
    )


def test_filtros_vao_e_voltam_como_foram():
    session = new_vault()
    text = "Café com pão · ação 😀 " + "x" * 90
    item = report(
        text=text[:120], kinds=["expense", "income"], categoryIds=["c1", "c2"], bankIds=["b1"]
    )
    service.apply_changes(session, _changes(1, {"reports": [item]}))
    assert _reports(session)["r1"]["filters"] == {**item["filters"], "text": text[:120].strip()}


# ---------------------------------------------------------------- nome


def test_nome_sem_espacos_sobrando_e_sem_repetir():
    session = new_vault()
    service.apply_changes(session, _changes(1, {"reports": [report(name="  Carro  ")]}))
    assert _reports(session)["r1"]["name"] == "Carro"
    assert "já existe" in _fails(session, {"reports": [report("r2", name="CARRO")]}, base=2)


def test_relatorios_antigos_com_o_mesmo_nome_continuam_editaveis():
    session = new_vault(data=_state(reports=[report(name="Mês"), report("r2", name="mês")]))
    service.apply_changes(
        session, _changes(1, {"reports": [{**report("r2", name="mês"), "groupBy": "bank"}]})
    )
    assert _reports(session)["r2"]["groupBy"] == "bank"


def test_restauracao_volta_relatorios_como_eram():
    session = new_vault()
    legacy = [report(name="Mês", bankIds=["nada"]), report("r2", name="mês")]
    _fails(session, {"reports": legacy})
    service.apply_changes(session, _changes(1, {"reports": legacy}, restore=True))
    assert len(_reports(session)) == 2


# ---------------------------------------------------------------- tetos e volume


def test_limite_de_relatorios_e_200_de_uma_vez():
    limit = models.MAX_ITEMS["reports"]
    session = new_vault()
    many = [
        report(f"r{i}", name=f"Relatório {i}", categoryIds=["c1"], bankIds=["b1"])
        for i in range(limit)
    ]
    started = time.perf_counter()
    service.apply_changes(session, _changes(1, {"reports": many}))
    elapsed = time.perf_counter() - started
    print(f"\n  {limit} relatórios salvos de uma vez: {elapsed * 1000:.0f} ms")
    assert elapsed < 2
    assert "passaria de" in _fails(session, {"reports": [report("extra", name="Extra")]}, base=2)


def _state(**overrides):
    base = {
        "version": 1,
        "banks": [bank()],
        "categories": [category(), category("c2", "income", nameKey="salary")],
        "transactions": [],
        "investments": [],
        "reports": [],
    }
    base.update(overrides)
    return base
