"""API dos cofres de ponta a ponta (FastAPI + cookie de sessão + middleware de segurança)."""

import base64

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402
from app.vaults import service  # noqa: E402
from app.vaults.sessions import LOGIN_THROTTLE, MAIL_LIMIT, SESSIONS  # noqa: E402

LOCAL = "http://127.0.0.1:8765"
H = {"X-App-Request": "1"}
PASSWORD = "senha-forte-123"
NOW = "2026-01-01T00:00:00Z"

SEED = {
    "version": 1,
    "banks": [
        {
            "id": "b1",
            "name": "Nubank",
            "code": "260",
            "kind": "digital",
            "color": "#8A05BE",
            "initialBalance": 0,
            "isPrimary": True,
            "createdAt": NOW,
            "updatedAt": NOW,
        }
    ],
    "categories": [
        {
            "id": "c1",
            "kind": "expense",
            "nameKey": "groceries",
            "icon": "cart",
            "color": "#30D158",
            "createdAt": NOW,
            "updatedAt": NOW,
        }
    ],
    "transactions": [],
    "investments": [],
    "reports": [],
}


@pytest.fixture(autouse=True)
def _clean():
    SESSIONS.clear()
    LOGIN_THROTTLE._failures.clear()
    MAIL_LIMIT._events.clear()
    yield
    SESSIONS.clear()


@pytest.fixture
def client():
    with TestClient(create_app(), base_url=LOCAL) as test_client:
        yield test_client


def create(client, name="Pessoal", email="gui@example.com"):
    return client.post(
        "/api/vaults",
        headers=H,
        json={
            "name": name,
            "firstName": "Guilherme",
            "lastName": "Henn",
            "email": email,
            "password": PASSWORD,
            "data": SEED,
            "settings": {"language": "pt", "theme": "dark"},
        },
    )


def test_fluxo_completo(client):
    assert client.get("/api/vaults").json() == []
    assert client.get("/api/session").status_code == 401

    created = create(client)
    assert created.status_code == 201, created.text
    cookie = created.headers["set-cookie"]
    assert "lume_session=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie or "samesite=strict" in cookie.lower()
    info = created.json()
    vault_id = info["vault"]["id"]
    assert info["account"]["firstName"] == "Guilherme"
    assert info["revision"] == 1

    # dados e gravação por diferenças
    data = client.get("/api/vault/data").json()
    assert data["data"]["banks"][0]["name"] == "Nubank"
    tx = {
        "id": "t1",
        "kind": "expense",
        "amount": 4590,
        "date": "2026-01-10",
        "bankId": "b1",
        "categoryId": "c1",
        "counterparty": "Padaria",
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    saved = client.post(
        "/api/vault/changes", headers=H, json={"baseRevision": 1, "upserts": {"transactions": [tx]}}
    )
    assert saved.json() == {"revision": 2}
    conflict = client.post(
        "/api/vault/changes",
        headers=H,
        json={"baseRevision": 1, "deletes": {"transactions": ["t1"]}},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {
        "code": "conflict",
        "message": "Os dados mudaram em outra janela.",
        "revision": 2,
    }
    bad = client.post(
        "/api/vault/changes",
        headers=H,
        json={"baseRevision": 2, "upserts": {"transactions": [{**tx, "amount": -1}]}},
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "invalid"

    # configurações
    assert (
        client.put("/api/vault/settings", headers=H, json={"theme": "light"}).json()["theme"]
        == "light"
    )

    # sair e entrar de novo
    assert client.delete("/api/session", headers=H).status_code == 204
    assert client.get("/api/vault/data").status_code == 401
    wrong = client.post(
        f"/api/vaults/{vault_id}/session",
        headers=H,
        json={"email": "gui@example.com", "password": "x"},
    )
    assert wrong.status_code == 401
    assert wrong.json()["detail"]["code"] == "bad-credentials"
    ok = client.post(
        f"/api/vaults/{vault_id}/session",
        headers=H,
        json={"email": "GUI@example.com", "password": PASSWORD},
    )
    assert ok.status_code == 200
    assert ok.json()["settings"]["theme"] == "light"
    assert len(client.get("/api/vault/data").json()["data"]["transactions"]) == 1

    listed = client.get("/api/vaults").json()
    assert listed[0]["name"] == "Pessoal"
    assert listed[0]["entries"] == 1
    assert "email" not in listed[0]


def test_escrita_exige_cabecalho_e_origem(client):
    assert create(client).status_code == 201
    no_header = client.post("/api/vault/changes", json={"baseRevision": 1})
    assert no_header.status_code == 403
    other_site = client.post(
        "/api/vault/changes",
        headers={**H, "Origin": "https://malicioso.example"},
        json={"baseRevision": 1},
    )
    assert other_site.status_code == 403
    assert client.post("/api/vaults", json={}).status_code == 403


def test_cookie_de_outro_cofre_nao_vale_e_troca_de_cofre(client):
    a = create(client, "A").json()["vault"]["id"]
    b = create(client, "B").json()["vault"]["id"]
    assert client.get("/api/session").json()["vault"]["id"] == b
    client.post(
        f"/api/vaults/{a}/session",
        headers=H,
        json={"email": "gui@example.com", "password": PASSWORD},
    )
    assert client.get("/api/session").json()["vault"]["id"] == a
    assert len(SESSIONS._sessions) == 1  # a sessão anterior foi encerrada
    # a aba que ainda mostra o cofre B não grava no A
    stale = client.post(
        "/api/vault/changes", headers={**H, "X-Vault-Id": b}, json={"baseRevision": 1}
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "vault-changed"
    assert client.get("/api/vault/data", headers={"X-Vault-Id": a}).status_code == 200
    client.cookies.set("lume_session", "inventado")
    assert client.get("/api/vault/data").status_code == 401


def test_muitas_tentativas_devolve_429(client):
    vault_id = create(client).json()["vault"]["id"]
    client.delete("/api/session", headers=H)
    for _ in range(6):
        client.post(
            f"/api/vaults/{vault_id}/session",
            headers=H,
            json={"email": "gui@example.com", "password": "errada"},
        )
    blocked = client.post(
        f"/api/vaults/{vault_id}/session",
        headers=H,
        json={"email": "gui@example.com", "password": PASSWORD},
    )
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    assert blocked.json()["detail"]["retryAfter"] > 0


def test_cofre_inexistente(client):
    resp = client.post(
        "/api/vaults/" + "a" * 32 + "/session",
        headers=H,
        json={"email": "a@b.co", "password": "x" * 8},
    )
    assert resp.status_code == 404
    assert client.post(
        "/api/vaults/../session", headers=H, json={"email": "a@b.co", "password": "x"}
    ).status_code in (404, 405)


def test_minha_conta_senha_e_email(client, monkeypatch):
    create(client)
    acc = client.get("/api/account").json()
    assert acc["email"] == "gui@example.com"
    assert acc["mail"] is None
    photo = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
    updated = client.put(
        "/api/account",
        headers=H,
        json={"firstName": "Gui", "lastName": "Henn", "email": "gui@example.com", "photo": photo},
    )
    assert updated.status_code == 200
    assert updated.json()["photo"] == photo
    kept = client.put(
        "/api/account",
        headers=H,
        json={"firstName": "Gui", "lastName": "H.", "email": "gui@example.com"},
    )
    assert kept.json()["photo"] == photo  # sem "photo" no corpo, a foto fica
    need_password = client.put(
        "/api/account", headers=H, json={"firstName": "Gui", "email": "novo@example.com"}
    )
    assert need_password.status_code == 403
    weak = client.post(
        "/api/account/password", headers=H, json={"currentPassword": PASSWORD, "newPassword": "123"}
    )
    assert weak.status_code == 422
    assert weak.json()["detail"]["code"] == "weak-password-short"
    changed = client.post(
        "/api/account/password",
        headers=H,
        json={"currentPassword": PASSWORD, "newPassword": "nova-senha-456"},
    )
    assert changed.json() == {"closedSessions": 0}
    assert client.get("/api/account").status_code == 200  # esta sessão continua

    mail = client.put(
        "/api/account/mail",
        headers=H,
        json={"provider": "gmail", "username": "gui@gmail.com", "password": "app-pass"},
    )
    assert mail.status_code == 200
    assert mail.json()["host"] == "smtp.gmail.com"
    assert mail.json()["hasPassword"] is True
    assert "password" not in mail.json()

    sent = []
    monkeypatch.setattr(
        "app.services.mailer.send", lambda config, outgoing: sent.append((config, outgoing))
    )
    attachment = {
        "filename": "../../lume-ir-2026.xlsx",
        "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "data": base64.b64encode(b"PK\x03\x04").decode(),
    }
    resp = client.post(
        "/api/mail/send",
        headers=H,
        json={"subject": "Planilha", "text": "Segue", "attachments": [attachment]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"to": "gui@example.com"}
    config, outgoing = sent[0]
    assert config.password == "app-pass"
    assert outgoing.attachments[0].filename == "_.._lume-ir-2026.xlsx"
    assert outgoing.attachments[0].data == b"PK\x03\x04"
    assert client.post("/api/account/mail/test", headers=H).json() == {"to": "gui@example.com"}

    def fail(config, outgoing):
        from app.services.mailer import MailError

        raise MailError("auth", "recusou")

    monkeypatch.setattr("app.services.mailer.send", fail)
    refused = client.post("/api/account/mail/test", headers=H)
    assert refused.status_code == 502
    assert refused.json()["detail"]["code"] == "mail-auth"
    assert client.delete("/api/account/mail", headers=H).status_code == 204
    assert (
        client.post("/api/account/mail/test", headers=H).json()["detail"]["code"]
        == "mail-not-configured"
    )


def test_renomear_e_excluir(client):
    create(client)
    assert client.patch("/api/vault", headers=H, json={"name": "Casa"}).json()["name"] == "Casa"
    assert (
        client.post("/api/vault/delete", headers=H, json={"password": "errada"}).status_code == 403
    )
    assert (
        client.post("/api/vault/delete", headers=H, json={"password": PASSWORD}).status_code == 204
    )
    assert client.get("/api/vaults").json() == []
    assert client.get("/api/session").status_code == 401


def test_criar_com_dados_invalidos(client):
    resp = client.post(
        "/api/vaults",
        headers=H,
        json={
            "name": "X",
            "firstName": "A",
            "email": "a@b.co",
            "password": PASSWORD,
            "data": {**SEED, "transactions": [{"id": "t"}]},
        },
    )
    assert resp.status_code == 422
    assert client.get("/api/vaults").json() == []


def test_redefinir_senha_pelo_terminal(client, capsys):
    from app import cli

    vault_id = create(client).json()["vault"]["id"]
    client.put(
        "/api/account/mail",
        headers=H,
        json={"provider": "gmail", "username": "g@gmail.com", "password": "app"},
    )
    client.delete("/api/session", headers=H)
    assert cli.main(["cofres"]) == 0
    assert "Pessoal" in capsys.readouterr().out
    assert cli.main(["redefinir-senha", "--cofre", "Pessoal", "--senha", "curta"]) == 1
    assert cli.main(["redefinir-senha", "--cofre", vault_id[:8], "--senha", "nova-senha-789"]) == 0
    session = service.login(vault_id, "gui@example.com", "nova-senha-789")
    assert service.account(session)["mail"]["hasPassword"] is False  # precisa digitar de novo
    assert cli.main(["backups", "--cofre", "Pessoal"]) == 0
    assert "before-reset" in capsys.readouterr().out


def test_codigo_de_recuperacao_pela_api(client):
    created = create(client)
    code = created.json()["recoveryCode"]
    vault_id = created.json()["vault"]["id"]
    assert created.json()["account"]["recovery"]["confirmed"] is False
    assert client.post("/api/account/recovery-code/confirm", headers=H).json()["confirmed"]
    client.delete("/api/session", headers=H)

    body = {"email": "gui@example.com", "recoveryCode": "X" * 20, "newPassword": "nova-senha-1"}
    wrong = client.post(f"/api/vaults/{vault_id}/recover", headers=H, json=body)
    assert wrong.status_code == 401
    assert wrong.json()["detail"]["code"] == "bad-recovery"
    weak = client.post(
        f"/api/vaults/{vault_id}/recover", headers=H, json={**body, "newPassword": "curta"}
    )
    assert weak.json()["detail"]["code"] == "weak-password-short"
    ok = client.post(
        f"/api/vaults/{vault_id}/recover", headers=H, json={**body, "recoveryCode": code}
    )
    assert ok.status_code == 200
    assert "lume_session=" in ok.headers["set-cookie"]
    assert ok.json()["recoveryCode"] != code
    assert client.get("/api/vault/data").status_code == 200

    bad = client.post("/api/account/recovery-code", headers=H, json={"currentPassword": "x" * 9})
    assert bad.status_code == 403
    fresh = client.post(
        "/api/account/recovery-code", headers=H, json={"currentPassword": "nova-senha-1"}
    )
    assert len(fresh.json()["recoveryCode"]) == 23


def test_erro_de_disco_vira_mensagem_amigavel(client, monkeypatch):
    import sqlite3

    create(client)

    def full(*_args, **_kwargs):
        raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(service, "apply_changes", full)
    resp = client.post("/api/vault/changes", headers=H, json={"baseRevision": 1})
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "storage"


def test_nome_repetido_pela_api(client):
    assert create(client, "Pessoal").status_code == 201
    again = create(client, "pessoal")
    assert again.status_code == 422
    assert again.json()["detail"]["code"] == "name-taken"
