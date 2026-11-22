"""Ambiente do Alembic.

Funciona de dois jeitos:
- pelo app (app/data/migrate.py), que passa a conexão pronta em ``config.attributes``;
- pela linha de comando, a partir de backend/: ``uv run alembic upgrade head``.

O banco usado é sempre o da configuração do app (.env / pasta de dados padrão).
"""

from alembic import context
from sqlmodel import SQLModel

from app.data import models  # noqa: F401  (registra as tabelas no metadata)
from app.data.db import database_url, get_engine

config = context.config
target_metadata = SQLModel.metadata


def _configure(**kwargs) -> None:  # noqa: ANN003
    context.configure(
        target_metadata=target_metadata,
        render_as_batch=True,  # necessário para ALTER TABLE no SQLite
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(url=database_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    with get_engine().connect() as own_connection:
        _configure(connection=own_connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
