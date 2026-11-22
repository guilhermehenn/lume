"""Lançamentos: o que a lista mostra é o que está no arquivo, e o arquivo não aceita ambiguidade."""

import sqlite3
import time

import pytest
from pydantic import ValidationError
from test_vaults import bank, category, inv, new_vault, state, tx

from app.vaults import models, registry, service


def _changes(base, upserts=None, deletes=None):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}}


def _sql(session, query, params=()):
    with sqlite3.connect(registry.path_for(session.vault_id)) as conn:
        return conn.execute(query, params).fetchall()


# ---------------------------------------------------------------- datas e meses


def test_totais_por_mes_no_arquivo_batem_com_as_datas_gravadas():
    """Datas são texto AAAA-MM-DD: nenhum fuso muda o dia, e as viradas de mês ficam no lugar."""
    rows = [
        ("a", "expense", 100, "2026-01-31"),
        ("b", "expense", 200, "2026-02-01"),
        ("c", "income", 300, "2028-02-29"),  # bissexto
        ("d", "expense", 400, "2026-12-31"),
        ("e", "income", 500, "2027-01-01"),
        ("f", "expense", 600, "1900-01-01"),
        ("g", "expense", 700, "2199-12-31"),
    ]
    data = state(
        categories=[category("c1"), category("c2", kind="income", name="Salário")],
        transactions=[
            tx(
                i,
                kind=k,
                amount=a,
                date=d,
                categoryId="c2" if k == "income" else "c1",
                paymentMethod=None if k == "income" else "pix",
            )
            for i, k, a, d in rows
        ],
    )
    session = new_vault(data=data)
    by_month = {
        (m, k): s
        for m, k, s in _sql(
            session,
            "SELECT substr(date, 1, 7), kind, SUM(amount) FROM transactions GROUP BY 1, 2",
        )
    }
    expected = {(d[:7], k): a for _, k, a, d in rows}
    assert by_month == expected
    loaded = {t["id"]: t["date"] for t in service.load_data(session)["data"]["transactions"]}
    assert loaded == {i: d for i, _, _, d in rows}


def test_editar_nao_muda_a_posicao_do_lancamento():
    """Empates de data e de criação ficam na ordem de gravação, antes e depois de editar."""
    data = state(transactions=[tx("t1"), tx("t2"), tx("t3")])
    session = new_vault(data=data)
    service.apply_changes(
        session, _changes(1, {"transactions": [tx("t1", amount=999, note="editado")]})
    )
    ids = [t["id"] for t in service.load_data(session)["data"]["transactions"]]
    assert ids == ["t1", "t2", "t3"]


# ---------------------------------------------------------------- data e hora de criação


@pytest.mark.parametrize(
    "stamp",
    [
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00.123Z",
        "2026-01-01T00:00:00.123456+00:00",
        "2026-01-01T10:00-03:00",
        "2026-01-01 10:00:00",
    ],
)
def test_data_e_hora_validas(stamp):
    session = new_vault(data=state())
    service.apply_changes(session, _changes(1, {"transactions": [tx("t2", createdAt=stamp)]}))


@pytest.mark.parametrize(
    "stamp",
    [
        "ontem",
        "",
        "2026-01-01",
        "2026-02-30T10:00:00Z",
        "2026-01-01T25:00:00Z",
        "2026-01-01T10:00:00.1234567Z",
        "2026-01-01T10:00:00Z; DROP TABLE transactions",
    ],
)
def test_data_e_hora_invalidas_sao_recusadas(stamp):
    session = new_vault(data=state())
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(1, {"transactions": [tx("t2", createdAt=stamp)]}))
    assert err.value.code == "invalid"
    assert "createdAt" in str(err.value)
    assert _sql(session, "SELECT COUNT(*) FROM transactions") == [(1,)]


# ---------------------------------------------------------------- lotes


def test_gravar_e_excluir_o_mesmo_lancamento_no_mesmo_lote_e_recusado():
    session = new_vault(data=state())
    with pytest.raises(ValidationError, match="gravado e excluído"):
        service.apply_changes(
            session,
            _changes(1, {"transactions": [tx("t1", amount=1)]}, {"transactions": ["t1"]}),
        )
    assert _sql(session, "SELECT amount FROM transactions") == [(4590,)]


def test_duas_versoes_do_mesmo_lancamento_no_lote_sao_recusadas():
    session = new_vault(data=state())
    with pytest.raises(ValidationError, match="duas vezes"):
        service.apply_changes(
            session, _changes(1, {"transactions": [tx("t9", amount=1), tx("t9", amount=2)]})
        )
    assert _sql(session, "SELECT COUNT(*) FROM transactions WHERE id = 't9'") == [(0,)]


def test_excluir_repetido_ou_que_nao_existe_nao_quebra():
    session = new_vault(data=state(transactions=[tx("t1"), tx("t2")]))
    changes = models.Changes.model_validate(
        _changes(1, deletes={"transactions": ["t1", "t1", "nao-existe"]})
    )
    assert changes.deletes["transactions"] == ["t1", "nao-existe"]
    assert service.apply_changes(session, _changes(1, deletes={"transactions": ["t1", "t1"]})) == 2
    assert _sql(session, "SELECT id FROM transactions") == [("t2",)]


def test_api_responde_422_para_lote_ambiguo(client_session):
    client = client_session
    response = client.post(
        "/api/vault/changes",
        json=_changes(1, {"transactions": [tx("t1")]}, {"transactions": ["t1"]}),
    )
    assert response.status_code == 422
    assert "excluído no mesmo lote" in response.json()["detail"]["message"]


# ---------------------------------------------------------------- volume


def test_excluir_20_mil_de_100_mil_de_uma_vez():
    transactions = [tx(f"t{i}") for i in range(100_000)]
    session = new_vault(data=state(banks=[bank()], investments=[inv()], transactions=transactions))
    started = time.perf_counter()
    service.apply_changes(
        session, _changes(1, deletes={"transactions": [f"t{i}" for i in range(0, 100_000, 5)]})
    )
    elapsed = time.perf_counter() - started
    print(f"\n  excluir 20 mil de 100 mil: {elapsed * 1000:.0f} ms")
    assert _sql(session, "SELECT COUNT(*) FROM transactions") == [(80_000,)]
    assert elapsed < 3


@pytest.fixture
def client_session(isolated_settings):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        client.headers["X-App-Request"] = "1"
        created = client.post(
            "/api/vaults",
            json={
                "name": "Lançamentos",
                "firstName": "Ana",
                "lastName": "Teste",
                "email": "ana@example.com",
                "password": "senha forte do lume",
                "data": state(),
            },
        )
        assert created.status_code == 201, created.text
        yield client
