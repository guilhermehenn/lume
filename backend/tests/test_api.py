import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import SERVICE_ID  # noqa: E402
from app.main import create_app  # noqa: E402

LOCAL = "http://127.0.0.1:8765"


@pytest.fixture
def client():
    with TestClient(create_app(), base_url=LOCAL) as test_client:
        yield test_client


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == SERVICE_ID
    assert response.headers["cache-control"] == "no-store"


def test_info_mostra_banco_pronto(client):
    body = client.get("/api/system/info").json()
    db = body["database"]
    assert db["journal_mode"] == "wal"
    assert db["foreign_keys"] is True
    assert db["schema_revision"] == db["schema_head"]


def test_pagina_provisoria(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "content-security-policy" in response.headers


def test_backup_exige_cabecalho(client):
    assert client.post("/api/backups").status_code == 403
    created = client.post("/api/backups", headers={"X-App-Request": "1"})
    assert created.status_code == 201
    names = [b["name"] for b in client.get("/api/backups").json()]
    assert created.json()["name"] in names


def test_host_externo_bloqueado(client):
    response = client.get("/api/health", headers={"Host": "evil.example.com"})
    assert response.status_code == 400


def test_mercado_e_noticias(client, monkeypatch):
    from app.services import market, news

    monkeypatch.setattr(
        market, "get_market", lambda force=False: {"quotes": [{"id": "USD"}], "indicators": []}
    )
    monkeypatch.setattr(news, "get_news", lambda force=False: {"items": [{"title": "x"}]})
    assert client.get("/api/market").json()["quotes"][0]["id"] == "USD"
    assert client.get("/api/news?refresh=true").json()["items"][0]["title"] == "x"
