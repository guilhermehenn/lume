"""Roda as migrations do Alembic pelo próprio app (sem depender do alembic.ini)."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from app.data.db import database_url, get_engine

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _escape(value: str) -> str:
    # O Alembic usa ConfigParser: "%" precisa virar "%%".
    return value.replace("%", "%%")


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", _escape(str(MIGRATIONS_DIR)))
    cfg.set_main_option("path_separator", "os")
    cfg.set_main_option("sqlalchemy.url", _escape(database_url()))
    return cfg


def head_revision() -> str | None:
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def current_revision() -> str | None:
    with get_engine().connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def is_pending() -> bool:
    return current_revision() != head_revision()


def upgrade(target: str = "head") -> None:
    cfg = alembic_config()
    with get_engine().begin() as connection:
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, target)


def downgrade(target: str) -> None:
    cfg = alembic_config()
    with get_engine().begin() as connection:
        cfg.attributes["connection"] = connection
        command.downgrade(cfg, target)
