"""Exportar: o backup que o app gera volta igual (valores extremos, textos difíceis, volume),
o e-mail com anexo grande demais é recusado cedo e o corpo das requisições tem teto."""

import asyncio
import base64
import re
import time
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402
from test_vault_api import LOCAL, H, create  # noqa: E402
from test_vaults import NOW, bank, category, inv, new_vault, state, tx  # noqa: E402

from app.api.security import MAX_BODY_BYTES, LocalSecurityMiddleware  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services import mailer  # noqa: E402
from app.vaults import models, service  # noqa: E402
from app.vaults.sessions import LOGIN_THROTTLE, MAIL_LIMIT, SESSIONS  # noqa: E402

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"


@pytest.fixture(autouse=True)
def _clean():
    SESSIONS.clear()
    LOGIN_THROTTLE._failures.clear()
    MAIL_LIMIT._events.clear()
    yield
    SESSIONS.clear()


def _restore(session, data: dict, base: int) -> int:
    """O mesmo lote que o navegador manda ao restaurar um backup: troca tudo, com restore=True."""
    current = service.load_data(session)["data"]
    deletes = {k: [x["id"] for x in current[k]] for k in models.COLLECTIONS}
    keep = {k: {x["id"] for x in data[k]} for k in models.COLLECTIONS}
    deletes = {k: [i for i in ids if i not in keep[k]] for k, ids in deletes.items()}
    upserts = {k: data[k] for k in models.COLLECTIONS if data[k]}
    payload = {"baseRevision": base, "upserts": upserts, "deletes": deletes, "restore": True}
    return service.apply_changes(session, payload)


def _edge_state() -> dict:
    """Tudo o que costuma quebrar exportação e importação, dentro do que o app aceita."""
    long_note = ('Observação; com "aspas", vírgula, ponto e vírgula e acentuação: ção ãõ ü. ' * 7)[
        :500
    ]
    return state(
        banks=[
            bank("b1", isPrimary=True, initialBalance=-models.MAX_CENTS),
            bank(
                "b2", name="Banco 🚀 Ñandú & Cia <XP>", code=None, initialBalance=models.MAX_CENTS
            ),
        ],
        categories=[
            category(),
            category("c2", "income", nameKey="salary"),
            category("c3", nameKey=None, name="=SOMA(A1:A9)", icon="tag"),
        ],
        transactions=[
            tx("t-min", date="1900-01-01", amount=1),
            tx("t-max", date="2199-12-31", amount=models.MAX_CENTS, bankId="b2"),
            tx(
                "t-leap", date="2024-02-29", counterparty="Café ☕ “Colombo” — 東京", note=long_note
            ),
            tx(
                "t-csv", categoryId="c3", counterparty="+55 51 9999-0000", note="@cmd|' /C calc'!A0"
            ),
            tx("t-inc", kind="income", categoryId="c2", paymentMethod=None, counterparty="X" * 120),
        ],
        investments=[
            inv(
                "i-btc",
                type="crypto",
                asset="BTC",
                quantity=0.00000001,
                unitPrice=1,
                fees=0,
                amount=1,
            ),
            inv(
                "i-big",
                asset="PETR4",
                quantity=999_999_999.5,
                unitPrice=1,
                fees=0,
                amount=1_000_000_000,
            ),
            inv(
                "i-earn",
                operation="earning",
                type="fii",
                asset="HGLG11",
                quantity=None,
                unitPrice=None,
                fees=None,
                amount=12345,
                earningKind="fii_income",
                taxWithheld=0,
            ),
        ],
    )


def _strip_none(items: list[dict]) -> list[dict]:
    return [{k: v for k, v in x.items() if v is not None} for x in items]


def test_backup_com_valores_extremos_volta_igual():
    """Criar um cofre com os dados de um backup e ler de volta: nada muda, nem um centavo."""
    data = _edge_state()
    session = new_vault(data=data)
    loaded = service.load_data(session)["data"]
    for key in ("banks", "categories", "transactions", "investments"):
        got = sorted(loaded[key], key=lambda x: x["id"])
        want = sorted(_strip_none(data[key]), key=lambda x: x["id"])
        assert got == want, key


def test_restaurar_backup_por_cima_de_outros_dados_volta_igual():
    """O backup exportado de um cofre, restaurado em outro com dados diferentes, fica idêntico."""
    original = service.load_data(new_vault(data=_edge_state()))["data"]
    other = new_vault(name="Outro", email="outro@example.com")
    rev = service.load_data(other)["revision"]
    _restore(other, original, rev)
    restored = service.load_data(other)["data"]
    for key in models.COLLECTIONS:
        assert sorted(restored[key], key=lambda x: x["id"]) == sorted(
            original[key], key=lambda x: x["id"]
        ), key


def test_backup_grande_restaura_e_abre_rapido():
    """100 mil lançamentos: o tamanho de um uso pesado de muitos anos."""
    banks = [bank("b1", isPrimary=True), bank("b2", name="XP", isPrimary=False)]
    many = [
        tx(
            f"t{i:06d}",
            amount=100 + i,
            date=f"{2000 + i % 27}-{1 + i % 12:02d}-{1 + i % 28:02d}",
            bankId="b1" if i % 3 else "b2",
            counterparty=f"Loja {i % 700}",
            createdAt=NOW,
        )
        for i in range(100_000)
    ]
    session = new_vault(data=state(banks=banks, transactions=[], investments=[]))
    started = time.perf_counter()
    _restore(session, state(banks=banks, transactions=many, investments=[]), 1)
    saved = time.perf_counter() - started
    started = time.perf_counter()
    loaded = service.load_data(session)["data"]["transactions"]
    opened = time.perf_counter() - started
    print(f"\n  100 mil lançamentos: restaurar {saved * 1000:.0f} ms, abrir {opened * 1000:.0f} ms")
    assert len(loaded) == 100_000
    assert sum(x["amount"] for x in loaded) == sum(x["amount"] for x in many)
    assert saved < 20 and opened < 3


# ---------------------------------------------------------------- e-mail


def test_limite_de_anexo_igual_ao_do_navegador():
    source = (FRONTEND / "app" / "mail.ts").read_text(encoding="utf-8")
    match = re.search(r"MAIL_MAX_BYTES = (\d+) \* 1024 \* 1024", source)
    assert match, "MAIL_MAX_BYTES não encontrado em mail.ts"
    assert int(match.group(1)) * 1024 * 1024 == mailer.MAX_ATTACHMENTS_BYTES


def test_teto_do_corpo_cabe_o_maior_backup_aceito_pelo_navegador():
    source = (FRONTEND / "data" / "backup.ts").read_text(encoding="utf-8")
    match = re.search(r"BACKUP_MAX_BYTES = (\d+) \* 1024 \* 1024", source)
    assert match
    assert int(match.group(1)) * 1024 * 1024 <= MAX_BODY_BYTES


@pytest.fixture
def client():
    with TestClient(create_app(), base_url=LOCAL) as c:
        yield c


def _setup_mail(client, monkeypatch):
    create(client)
    resp = client.put(
        "/api/account/mail",
        headers=H,
        json={"provider": "gmail", "username": "gui@gmail.com", "password": "app-pass"},
    )
    assert resp.status_code == 200
    sent = []
    monkeypatch.setattr("app.services.mailer.send", lambda config, outgoing: sent.append(outgoing))
    return sent


def _attachment(size: int, name="lume-backup.json") -> dict:
    return {
        "filename": name,
        "contentType": "application/json",
        "data": base64.b64encode(b"x" * size).decode(),
    }


def test_anexo_grande_demais_recusado_antes_de_decodificar(client, monkeypatch):
    sent = _setup_mail(client, monkeypatch)
    big = mailer.MAX_ATTACHMENTS_BYTES + 3
    resp = client.post(
        "/api/mail/send",
        headers=H,
        json={"subject": "B", "text": "t", "attachments": [_attachment(big)]},
    )
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "mail-too-big"
    assert "15 MB" in resp.json()["detail"]["message"]
    assert sent == []


def test_varios_anexos_somados_passam_do_limite(client, monkeypatch):
    sent = _setup_mail(client, monkeypatch)
    half = mailer.MAX_ATTACHMENTS_BYTES // 2 + 1024
    files = [_attachment(half, "a.csv"), _attachment(half, "b.csv")]
    resp = client.post(
        "/api/mail/send", headers=H, json={"subject": "B", "text": "t", "attachments": files}
    )
    assert resp.status_code == 413
    assert sent == []


def test_anexo_no_limite_passa_e_recusa_nao_gasta_tentativas(client, monkeypatch):
    sent = _setup_mail(client, monkeypatch)
    big = [_attachment(mailer.MAX_ATTACHMENTS_BYTES + 3)]
    for _ in range(25):  # mais que o limite de envios (20): recusado cedo, não conta tentativa
        client.post(
            "/api/mail/send", headers=H, json={"subject": "B", "text": "t", "attachments": big}
        )
    ok = [_attachment(mailer.MAX_ATTACHMENTS_BYTES)]
    resp = client.post(
        "/api/mail/send", headers=H, json={"subject": "B", "text": "t", "attachments": ok}
    )
    assert resp.status_code == 200, resp.text
    assert len(sent[0].attachments[0].data) == mailer.MAX_ATTACHMENTS_BYTES


def test_anexo_absurdo_nem_e_aceito(client, monkeypatch):
    _setup_mail(client, monkeypatch)
    huge = "A" * (4 * mailer.MAX_ATTACHMENTS_BYTES)
    body = {"subject": "B", "text": "t", "attachments": [{"filename": "x", "data": huge}]}
    resp = client.post("/api/mail/send", headers=H, json=body)
    assert resp.status_code == 422


# ---------------------------------------------------------------- teto do corpo


async def _ok_app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


def _post(length: str) -> int:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/vault/changes",
        "headers": [
            (b"host", b"127.0.0.1:8765"),
            (b"x-app-request", b"1"),
            (b"content-length", length.encode()),
        ],
    }
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(LocalSecurityMiddleware(_ok_app)(scope, receive, send))
    return sent[0]["status"]


def test_corpo_acima_do_teto_e_recusado_sem_ler():
    assert _post(str(MAX_BODY_BYTES + 1)) == 413
    assert _post(str(MAX_BODY_BYTES)) == 200
    assert _post("abc") == 200  # cabeçalho estranho: o servidor HTTP é quem recusa
