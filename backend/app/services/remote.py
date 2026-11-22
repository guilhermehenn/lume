"""Acesso à internet do back-end: só para endereços conhecidos, com limite de tempo e tamanho.

O front-end nunca fala direto com sites de terceiros (a política de segurança do app
bloqueia). Ele pede ao back-end, que busca só nos endereços desta lista.
"""

from __future__ import annotations

import contextlib
import json
import logging
import math
import os
import threading
import time
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app import __version__
from app.core import paths

log = logging.getLogger(__name__)

ALLOWED_PREFIXES = (
    "https://economia.awesomeapi.com.br/",
    "https://api.bcb.gov.br/dados/serie/",
    "https://www.infomoney.com.br/",
    "https://www.moneytimes.com.br/",
)
MAX_BYTES = 3_000_000
TIMEOUT_SECONDS = 6.0
USER_AGENT = f"Lume/{__version__} (aplicativo local de finanças pessoais)"


class RemoteError(Exception):
    """Falha ao buscar dados externos."""


def fetch_bytes(url: str, *, timeout: float = TIMEOUT_SECONDS, max_bytes: int = MAX_BYTES) -> bytes:
    if not url.startswith(ALLOWED_PREFIXES):
        raise RemoteError(f"Endereço não permitido: {url}")
    request = urllib.request.Request(  # noqa: S310 (só https e endereços da lista acima)
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/rss+xml, */*"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            data = response.read(max_bytes + 1)
    except (OSError, ValueError) as exc:
        raise RemoteError(f"{url}: {exc}") from exc
    if len(data) > max_bytes:
        raise RemoteError(f"{url}: resposta grande demais")
    return data


def fetch_json(url: str) -> Any:
    try:
        return json.loads(fetch_bytes(url).decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise RemoteError(f"{url}: JSON inválido ({exc})") from exc


def finite(value: Any) -> float:
    """Número vindo de fora: recusa NaN e infinito (viram JSON inválido na resposta)."""
    number = float(str(value).replace(",", "."))
    if not math.isfinite(number):
        raise ValueError(f"número inválido: {value!r}")
    return number


class TimedCache:
    """Cache em memória com validade, gravado também em disco.

    Assim o app mostra os últimos dados conhecidos mesmo sem internet ou depois de reiniciar.

    ``lock`` faz uma busca por vez (várias abas pedindo juntas esperam a mesma resposta) e
    ``last_attempt`` registra a última tentativa, para não insistir a cada pedido quando a
    internet caiu.
    """

    def __init__(self, name: str, ttl_seconds: float, clock: Callable[[], float] = time.time):
        self.name = name
        self.ttl = ttl_seconds
        self.clock = clock
        self.lock = threading.Lock()
        self.last_attempt = float("-inf")
        self.last_errors: list[str] = []
        self._value: dict[str, Any] | None = None
        self._stored_at = 0.0
        self._loaded_from_disk = False

    def since_attempt(self) -> float:
        return self.clock() - self.last_attempt

    def mark_attempt(self) -> None:
        self.last_attempt = self.clock()

    def _file(self) -> Path:
        return paths.data_dir() / "cache" / f"{self.name}.json"

    def _load_disk(self) -> None:
        if self._loaded_from_disk:
            return
        self._loaded_from_disk = True
        try:
            raw = json.loads(self._file().read_text(encoding="utf-8"))
            value, stored_at = raw["value"], finite(raw["stored_at"])
        except (OSError, ValueError, KeyError, TypeError):
            return
        if isinstance(value, dict):
            self._value, self._stored_at = value, stored_at

    def get(self) -> dict[str, Any] | None:
        self._load_disk()
        return self._value

    def age(self) -> float:
        self._load_disk()
        if self._value is None:
            return float("inf")
        age = self.clock() - self._stored_at
        # Gravado "no futuro" (relógio do computador voltou): vale como vencido, senão o
        # cache nunca venceria.
        return age if age > -60 else float("inf")

    def is_fresh(self) -> bool:
        return self.age() < self.ttl

    def set(self, value: dict[str, Any]) -> None:
        self._value = value
        self._stored_at = self.clock()
        self._loaded_from_disk = True
        tmp: Path | None = None
        try:
            target = self._file()
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(f".{os.getpid()}-{threading.get_ident()}.tmp")
            tmp.write_text(
                json.dumps({"stored_at": self._stored_at, "value": value}, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp.replace(target)
        except OSError as exc:
            log.warning("Não foi possível gravar o cache %s: %s", self.name, exc)
            if tmp is not None:
                with contextlib.suppress(OSError):
                    tmp.unlink(missing_ok=True)

    def clear(self) -> None:
        self._value = None
        self._stored_at = 0.0
        self._loaded_from_disk = True
        self.last_attempt = float("-inf")
        self.last_errors = []
