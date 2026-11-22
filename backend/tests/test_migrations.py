import uuid
from datetime import date

import pytest

pytest.importorskip("sqlmodel")
pytest.importorskip("alembic")

import sqlalchemy as sa  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.data import migrate  # noqa: E402
from app.data.db import get_engine  # noqa: E402
from app.data.models import Account, Transaction, User  # noqa: E402

EXPECTED_TABLES = {"users", "accounts", "categories", "transactions", "alembic_version"}


def test_upgrade_cria_tabelas_e_fica_na_ultima_revisao():
    assert migrate.is_pending()
    migrate.upgrade()
    assert not migrate.is_pending()
    assert migrate.current_revision() == migrate.head_revision()
    tables = set(sa.inspect(get_engine()).get_table_names())
    assert tables >= EXPECTED_TABLES


def test_pragmas_do_sqlite():
    with get_engine().connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"


def test_grava_e_le_pelo_orm():
    migrate.upgrade()
    with Session(get_engine()) as session:
        user = User(name="Teste")
        session.add(user)
        session.flush()
        account = Account(user_id=user.id, name="Conta corrente", kind="checking")
        session.add(account)
        session.flush()
        tx = Transaction(
            user_id=user.id,
            account_id=account.id,
            kind="expense",
            amount_cents=12345,
            occurred_on=date(2026, 11, 20),
            description="Mercado",
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    with Session(get_engine()) as session:
        loaded = session.get(Transaction, tx_id)
        assert loaded is not None
        assert loaded.amount_cents == 12345
        assert loaded.occurred_on == date(2026, 11, 20)


def test_chave_estrangeira_e_obrigatoria():
    migrate.upgrade()
    with Session(get_engine()) as session:
        user = User(name="Teste")
        session.add(user)
        session.commit()
        user_id = user.id

    with Session(get_engine()) as session:
        session.add(
            Transaction(
                user_id=user_id,
                account_id=uuid.uuid4(),  # conta que não existe
                kind="expense",
                amount_cents=100,
                occurred_on=date(2026, 11, 20),
                description="Inválido",
            )
        )
        with pytest.raises(sa.exc.IntegrityError):
            session.commit()


def test_downgrade_e_upgrade_de_novo():
    migrate.upgrade()
    migrate.downgrade("base")
    assert migrate.current_revision() is None
    migrate.upgrade()
    assert not migrate.is_pending()
