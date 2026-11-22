"""Lançamentos novos no banco (revisão da função "Novo"): validação, conferências do conjunto,
última barreira no COMMIT, limites, concorrência e desempenho com muitos dados."""

import time

import pytest
from test_vaults import bank, category, inv, new_vault, state, tx

from app.vaults import models, registry, service, store


def _changes(base, upserts=None, deletes=None):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}}


def _fails(session, base, upserts=None, deletes=None) -> str:
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(base, upserts, deletes))
    assert err.value.code == "invalid"
    return str(err.value)


# ---------------------------------------------------------------- validação dos campos


@pytest.mark.parametrize(
    ("field", "value", "ok"),
    [
        ("amount", 1, True),
        ("amount", models.MAX_CENTS, True),
        ("amount", models.MAX_CENTS + 1, False),
        ("amount", 0, False),
        ("amount", -100, False),
        ("amount", 45.9, False),
        ("date", "1900-01-01", True),
        ("date", "2199-12-31", True),
        ("date", "1899-12-31", False),
        ("date", "2200-01-01", False),
        ("date", "2024-02-29", True),
        ("date", "2023-02-29", False),
        ("date", "20/11/2026", False),
        ("counterparty", "   ", False),
        ("counterparty", "x" * 121, False),
        ("counterparty", "  Padaria São João  ", True),
        ("note", "x" * 501, False),
    ],
)
def test_campos_do_lancamento(field, value, ok):
    data = tx(**{field: value})
    if ok:
        models.Transaction.model_validate(data)
    else:
        with pytest.raises(ValueError):
            models.Transaction.model_validate(data)


def test_texto_e_forma_de_pagamento(isolated_settings):
    session = new_vault()
    service.apply_changes(
        session,
        _changes(
            1, {"transactions": [tx("n1", counterparty="  Robert'); DROP TABLE banks;-- 🍕 ")]}
        ),
    )
    saved = {t["id"]: t for t in service.load_data(session)["data"]["transactions"]}
    assert saved["n1"]["counterparty"] == "Robert'); DROP TABLE banks;-- 🍕"
    income = tx("n2", kind="income", categoryId="c2", paymentMethod="pix")
    assert "forma de pagamento" in _fails(session, 2, {"transactions": [income]})
    income.pop("paymentMethod")
    service.apply_changes(session, _changes(2, {"transactions": [income]}))


# ---------------------------------------------------------------- conferências do conjunto


def test_conferencias_pegam_cada_tipo_de_referencia_quebrada(isolated_settings):
    session = new_vault(
        data=state(categories=[category(), category("c2", "income", nameKey="salary")])
    )
    rev = 1
    assert "não existe" in _fails(session, rev, {"transactions": [tx("n", bankId="nada")]})
    assert "não existe" in _fails(session, rev, {"transactions": [tx("n", categoryId="nada")]})
    assert "outro tipo" in _fails(session, rev, {"transactions": [tx("n", categoryId="c2")]})
    assert "não existe" in _fails(session, rev, {"investments": [inv("n", bankId="nada")]})
    assert "ainda tem" in _fails(session, rev, deletes={"categories": ["c1"]})
    assert "ainda tem" in _fails(session, rev, deletes={"banks": ["b1"]})
    # Mudar o tipo de uma categoria em uso também é recusado
    assert "outro tipo" in _fails(session, rev, {"categories": [category("c1", "income")]})
    assert service.load_data(session)["revision"] == rev  # nada foi gravado

    # Mover os lançamentos e excluir o banco na mesma gravação: vale
    rev = service.apply_changes(
        session,
        _changes(
            rev,
            {
                "banks": [bank("b2", name="Outro")],
                "transactions": [tx(bankId="b2")],
                "investments": [inv(bankId="b2")],
            },
            {"banks": ["b1"]},
        ),
    )
    assert rev == 2


def test_ultima_barreira_no_commit(isolated_settings, monkeypatch):
    """Se as conferências deixassem passar, o próprio SQLite recusa e nada é gravado."""
    session = new_vault()
    monkeypatch.setattr(store, "_check_integrity", lambda *_args, **_kwargs: None)
    assert "inconsistentes" in _fails(session, 1, {"transactions": [tx("n", bankId="nada")]})
    monkeypatch.undo()
    data = service.load_data(session)
    assert data["revision"] == 1
    assert [t["id"] for t in data["data"]["transactions"]] == ["t1"]
    # A conexão seguinte funciona normalmente
    assert service.apply_changes(session, _changes(1, {"transactions": [tx("ok")]})) == 2


def test_gravar_o_mesmo_lancamento_duas_vezes_nao_duplica(isolated_settings):
    session = new_vault()
    service.apply_changes(session, _changes(1, {"transactions": [tx("n", amount=100)]}))
    service.apply_changes(session, _changes(2, {"transactions": [tx("n", amount=250)]}))
    rows = [t for t in service.load_data(session)["data"]["transactions"] if t["id"] == "n"]
    assert len(rows) == 1 and rows[0]["amount"] == 250


def test_duas_abas_lancando_ao_mesmo_tempo_nao_perdem_nada(isolated_settings):
    session = new_vault()
    service.apply_changes(session, _changes(1, {"transactions": [tx("aba1")]}))
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(1, {"transactions": [tx("aba2")]}))
    assert err.value.code == "conflict" and err.value.revision == 2
    # A segunda aba recarrega, reaplica o que tinha e grava de novo (como o front faz)
    service.apply_changes(session, _changes(2, {"transactions": [tx("aba2")]}))
    ids = {t["id"] for t in service.load_data(session)["data"]["transactions"]}
    assert {"aba1", "aba2"} <= ids


# ---------------------------------------------------------------- desempenho


def test_gravar_um_lancamento_nao_depende_do_tamanho_do_cofre(isolated_settings):
    many = state(transactions=[tx(f"t{i}") for i in range(100_000)])
    session = new_vault(data=many)
    path = registry.path_for(session.vault_id)
    timings = []
    rev = 1
    for i in range(5):
        started = time.perf_counter()
        rev = service.apply_changes(session, _changes(rev, {"transactions": [tx(f"novo{i}")]}))
        timings.append(time.perf_counter() - started)
    best = min(timings)

    started = time.perf_counter()
    batch = [tx(f"lote{i}") for i in range(5_000)]
    rev = service.apply_changes(session, _changes(rev, {"transactions": batch}))
    batch_time = time.perf_counter() - started
    with store.connect(path, readonly=True) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 105_005
    print(
        f"\n  100 mil no cofre: gravar 1 = {best * 1000:.0f} ms;"
        f" gravar 5 mil de uma vez = {batch_time:.2f} s"
    )
    assert best < 0.25
    assert batch_time < 10
