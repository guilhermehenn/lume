"""Conexão com o banco.

Hoje: SQLite local em modo WAL. Na nuvem: trocar ``database_url`` por PostgreSQL.
Os PRAGMAs abaixo valem só para SQLite.
"""

from __future__ import annotations

from functools import lru_cache

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.core.paths import db_file


def database_url() -> str:
    return f"sqlite:///{db_file().as_posix()}"


def _apply_sqlite_pragmas(dbapi_connection, _connection_record) -> None:  # noqa: ANN001
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")  # o SQLite vem com isso DESLIGADO
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=10000")
    finally:
        cursor.close()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    # O SQLite cria o arquivo, mas não a pasta: sem ela, "unable to open database file".
    db_file().parent.mkdir(parents=True, exist_ok=True)
    engine = sa.create_engine(
        database_url(),
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    event.listen(engine, "connect", _apply_sqlite_pragmas)
    return engine


def reset_engine() -> None:
    """Fecha as conexões e descarta o engine em cache (usado nos testes e no restore)."""
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
