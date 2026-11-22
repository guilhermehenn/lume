"""Middleware de segurança testado direto no protocolo ASGI (sem servidor)."""

import asyncio

import pytest

from app.api.security import LocalSecurityMiddleware, hostname_of, is_same_origin


async def _ok_app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


def _call(method="GET", path="/api/health", headers=None):
    hdrs = [(b"host", b"127.0.0.1:8765")]
    for key, value in (headers or {}).items():
        if key.lower() == "host":
            hdrs = [h for h in hdrs if h[0] != b"host"]
        hdrs.append((key.lower().encode(), value.encode()))
    scope = {"type": "http", "method": method, "path": path, "headers": hdrs}
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(LocalSecurityMiddleware(_ok_app)(scope, receive, send))
    start = sent[0]
    headers_out = {k.decode(): v.decode() for k, v in start["headers"]}
    return start["status"], headers_out


def test_get_local_passa_com_cabecalhos_de_seguranca():
    status, headers = _call()
    assert status == 200
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in headers
    assert headers["cache-control"] == "no-store"


@pytest.mark.parametrize("host", ["evil.example.com", "evil.example.com:8765", "192.168.0.10:8765"])
def test_bloqueia_host_estranho(host):
    status, _ = _call(headers={"Host": host})
    assert status == 400


@pytest.mark.parametrize("host", ["localhost:8765", "[::1]:8765", "127.0.0.1"])
def test_aceita_hosts_locais(host):
    status, _ = _call(headers={"Host": host})
    assert status == 200


def test_post_sem_cabecalho_csrf_e_bloqueado():
    status, _ = _call(method="POST", path="/api/backups")
    assert status == 403


def test_post_com_cabecalho_passa():
    status, _ = _call(method="POST", path="/api/backups", headers={"X-App-Request": "1"})
    assert status == 200


def test_post_de_outra_origem_e_bloqueado():
    status, _ = _call(
        method="POST",
        path="/api/backups",
        headers={"X-App-Request": "1", "Origin": "https://site-malicioso.com"},
    )
    assert status == 403


def test_post_da_mesma_origem_passa():
    status, _ = _call(
        method="POST",
        path="/api/backups",
        headers={"X-App-Request": "1", "Origin": "http://127.0.0.1:8765"},
    )
    assert status == 200


def test_docs_sem_csp():
    _, headers = _call(path="/api/docs")
    assert "content-security-policy" not in headers


def test_helpers():
    assert hostname_of("[::1]:8765") == "[::1]"
    assert hostname_of("LOCALHOST:1") == "localhost"
    assert is_same_origin("http://127.0.0.1:8765", "127.0.0.1:8765")
    assert not is_same_origin("null", "127.0.0.1:8765")
    assert not is_same_origin("https://127.0.0.1:8765", "127.0.0.1:8765")
