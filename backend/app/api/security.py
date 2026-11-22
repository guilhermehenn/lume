"""Proteções para um servidor que roda em 127.0.0.1.

Um site qualquer aberto no navegador consegue mandar requisições para o
localhost. Este middleware (ASGI puro, sem dependências) bloqueia isso:

1. Host: só aceita 127.0.0.1, localhost e [::1] (protege contra DNS rebinding);
2. escrita (POST/PUT/PATCH/DELETE) em /api exige o cabeçalho ``X-App-Request: 1``.
   Navegadores não deixam outro site enviar esse cabeçalho sem permissão de CORS,
   que este servidor nunca concede;
3. se o navegador informar a origem (Origin), ela precisa ser este mesmo endereço;
4. corpo com mais de ``MAX_BODY_BYTES`` é recusado antes de ser lido (413);
5. cabeçalhos de segurança em todas as respostas (CSP, nosniff, sem iframes, sem cache na API).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, MutableMapping
from typing import Any
from urllib.parse import urlsplit

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

DEFAULT_ALLOWED_HOSTS: tuple[str, ...] = ("127.0.0.1", "localhost", "[::1]")
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CSRF_HEADER = "x-app-request"
DOCS_PATHS = ("/api/docs", "/api/redoc", "/api/openapi.json")
#: Maior corpo de requisição aceito. O maior uso legítimo é restaurar o backup de um cofre cheio
#: (os tetos de ``models.MAX_ITEMS``), cerca de 130 MB; o navegador aceita arquivos de até 256 MB.
MAX_BODY_BYTES = 256 * 1024 * 1024

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
    "frame-ancestors 'none'; form-action 'self'"
)
BASE_HEADERS: tuple[tuple[str, str], ...] = (
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "DENY"),
    ("referrer-policy", "no-referrer"),
    ("cross-origin-opener-policy", "same-origin"),
    ("cross-origin-resource-policy", "same-origin"),
    ("permissions-policy", "camera=(), microphone=(), geolocation=()"),
)


def hostname_of(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    return host.split(":", 1)[0]


def is_same_origin(origin: str, host_header: str) -> bool:
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    return parts.scheme == "http" and parts.netloc.lower() == host_header.strip().lower()


def security_headers_for(path: str) -> list[tuple[str, str]]:
    headers = list(BASE_HEADERS)
    if not path.startswith(DOCS_PATHS):
        # A documentação interativa (/api/docs) carrega arquivos de um CDN, então fica sem CSP.
        headers.append(("content-security-policy", CONTENT_SECURITY_POLICY))
    if path.startswith("/api/"):
        headers.append(("cache-control", "no-store"))
    return headers


class LocalSecurityMiddleware:
    def __init__(self, app: ASGIApp, allowed_hosts: Iterable[str] = DEFAULT_ALLOWED_HOSTS) -> None:
        self.app = app
        self.allowed_hosts = frozenset(h.lower() for h in allowed_hosts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        path = scope.get("path", "")
        host_header = headers.get("host", "")

        if hostname_of(host_header) not in self.allowed_hosts:
            await _reject(send, 400, "Host não permitido.", path)
            return

        length = headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_BODY_BYTES:
            await _reject(send, 413, "Requisição grande demais.", path)
            return

        if scope.get("method", "GET").upper() not in SAFE_METHODS:
            origin = headers.get("origin")
            if origin is not None and not is_same_origin(origin, host_header):
                await _reject(send, 403, "Origem não permitida.", path)
                return
            if path.startswith("/api/") and headers.get(CSRF_HEADER) != "1":
                await _reject(send, 403, "Cabeçalho X-App-Request ausente.", path)
                return

        extra = security_headers_for(path)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                current = list(message.get("headers", []))
                present = {k.decode("latin-1").lower() for k, _ in current}
                for key, value in extra:
                    if key not in present:
                        current.append((key.encode("latin-1"), value.encode("latin-1")))
                message = {**message, "headers": current}
            await send(message)

        await self.app(scope, receive, send_with_headers)


async def _reject(send: Send, status: int, text: str, path: str) -> None:
    body = text.encode("utf-8")
    headers = [
        (b"content-type", b"text/plain; charset=utf-8"),
        (b"content-length", str(len(body)).encode("latin-1")),
    ]
    headers += [(k.encode("latin-1"), v.encode("latin-1")) for k, v in security_headers_for(path)]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})
