"""Sessões abertas e proteção contra tentativas de senha em sequência.

Tudo fica só em memória: fechar o Lume encerra todas as sessões, então ao abrir
de novo é preciso entrar com e-mail e senha. A chave de dados do cofre também
só existe aqui, enquanto a sessão estiver aberta.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

IDLE_SECONDS = 2 * 60 * 60  # sem uso por 2 h: pede a senha de novo
MAX_SECONDS = 24 * 60 * 60


@dataclass
class Session:
    token: str
    vault_id: str
    owner_id: str
    data_key: bytes
    created: float
    last_seen: float


class SessionStore:
    def __init__(
        self,
        idle: float = IDLE_SECONDS,
        maximum: float = MAX_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.idle = idle
        self.maximum = maximum
        self.clock = clock
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def _expired(self, session: Session, now: float) -> bool:
        return now - session.last_seen > self.idle or now - session.created > self.maximum

    def _prune(self, now: float) -> None:
        """Tira da memória as sessões vencidas (e a chave de dados delas). Chamar com o lock.

        Antes, uma sessão só saía quando o mesmo cookie voltava: abas fechadas deixavam a chave
        do cofre na memória até o Lume fechar, e a troca de senha contava sessões já vencidas
        como "outras sessões encerradas".
        """
        for token in [t for t, s in self._sessions.items() if self._expired(s, now)]:
            del self._sessions[token]

    def create(self, vault_id: str, owner_id: str, data_key: bytes) -> Session:
        now = self.clock()
        session = Session(secrets.token_urlsafe(32), vault_id, owner_id, data_key, now, now)
        with self._lock:
            self._prune(now)
            self._sessions[session.token] = session
        return session

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def get(self, token: str | None) -> Session | None:
        if not token:
            return None
        now = self.clock()
        with self._lock:
            session = self._sessions.get(token)
            if session is None:
                return None
            if self._expired(session, now):
                del self._sessions[token]
                return None
            session.last_seen = now
            return session

    def revoke(self, token: str | None) -> None:
        if token:
            with self._lock:
                self._sessions.pop(token, None)

    def revoke_vault(self, vault_id: str, keep: str | None = None) -> int:
        """Encerra as sessões do cofre (menos ``keep``). Retorna quantas estavam valendo."""
        with self._lock:
            self._prune(self.clock())
            doomed = [t for t, s in self._sessions.items() if s.vault_id == vault_id and t != keep]
            for token in doomed:
                del self._sessions[token]
        return len(doomed)

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()


@dataclass
class _Failures:
    times: list[float] = field(default_factory=list)


class Throttle:
    """Limite de tentativas por cofre.

    Até ``free`` erros em ``window`` segundos não há espera; depois disso a espera dobra
    a cada erro (15 s, 30 s, 60 s…) até ``max_wait``. Acertar a senha zera a contagem.
    """

    def __init__(
        self,
        free: int = 5,
        window: float = 15 * 60,
        base: float = 15,
        max_wait: float = 300,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.free = free
        self.window = window
        self.base = base
        self.max_wait = max_wait
        self.clock = clock
        self._failures: dict[str, _Failures] = {}
        self._lock = threading.Lock()

    def wait_seconds(self, key: str) -> int:
        now = self.clock()
        with self._lock:
            record = self._failures.get(key)
            if record is None:
                return 0
            record.times = [t for t in record.times if now - t <= self.window]
            extra = len(record.times) - self.free
            if extra <= 0 or not record.times:
                return 0
            wait = min(self.max_wait, self.base * 2**extra)
            remaining = wait - (now - record.times[-1])
            return max(0, int(remaining + 0.999))

    def fail(self, key: str) -> None:
        with self._lock:
            self._failures.setdefault(key, _Failures()).times.append(self.clock())

    def success(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


class RateLimit:
    """No máximo ``limit`` ações em ``window`` segundos (ex.: e-mails enviados)."""

    def __init__(self, limit: int, window: float, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window
        self.clock = clock
        self._events: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = self.clock()
        with self._lock:
            events = [t for t in self._events.get(key, []) if now - t <= self.window]
            if len(events) >= self.limit:
                self._events[key] = events
                return False
            events.append(now)
            self._events[key] = events
            return True


SESSIONS = SessionStore()
LOGIN_THROTTLE = Throttle()
MAIL_LIMIT = RateLimit(limit=20, window=10 * 60)
