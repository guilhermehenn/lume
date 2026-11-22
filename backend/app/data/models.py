"""Modelos do banco (esquema inicial, provisório).

Regras que valem para todas as tabelas:
- chave primária UUID (facilita sincronizar/migrar para a nuvem no futuro);
- dinheiro em centavos inteiros (``*_cents``), nunca float;
- data do lançamento é DATE (sem hora, sem fuso);
- created_at/updated_at em UTC;
- tudo pertence a um ``user`` (hoje existe um só, o usuário local).

Os tipos SQLAlchemy são explícitos (sa_type) para o esquema não mudar
sozinho quando o SQLModel mudar seus padrões.
"""

import uuid
from datetime import UTC, date, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
SQLModel.metadata.naming_convention = NAMING_CONVENTION

ACCOUNT_KINDS = ("checking", "savings", "wallet", "credit_card", "investment")
CATEGORY_KINDS = ("income", "expense")
TRANSACTION_KINDS = ("income", "expense", "transfer")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Timestamped(SQLModel):
    created_at: datetime = Field(
        default_factory=utcnow, sa_type=sa.DateTime(timezone=True), nullable=False
    )
    updated_at: datetime = Field(
        default_factory=utcnow, sa_type=sa.DateTime(timezone=True), nullable=False
    )


class User(Timestamped, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=sa.Uuid())
    name: str = Field(max_length=120, sa_type=sa.String(120))


class Account(Timestamped, table=True):
    __tablename__ = "accounts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=sa.Uuid())
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True, sa_type=sa.Uuid())
    name: str = Field(max_length=120, sa_type=sa.String(120))
    kind: str = Field(max_length=20, sa_type=sa.String(20))
    currency: str = Field(default="BRL", max_length=3, sa_type=sa.String(3))
    opening_balance_cents: int = Field(default=0)
    is_archived: bool = Field(default=False, sa_type=sa.Boolean())


class Category(Timestamped, table=True):
    __tablename__ = "categories"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=sa.Uuid())
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True, sa_type=sa.Uuid())
    parent_id: uuid.UUID | None = Field(
        default=None, foreign_key="categories.id", nullable=True, sa_type=sa.Uuid()
    )
    name: str = Field(max_length=80, sa_type=sa.String(80))
    kind: str = Field(max_length=10, sa_type=sa.String(10))
    color: str | None = Field(default=None, max_length=9, nullable=True, sa_type=sa.String(9))
    icon: str | None = Field(default=None, max_length=40, nullable=True, sa_type=sa.String(40))
    is_archived: bool = Field(default=False, sa_type=sa.Boolean())


class Transaction(Timestamped, table=True):
    __tablename__ = "transactions"
    __table_args__ = (sa.CheckConstraint("amount_cents > 0", name="amount_positive"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=sa.Uuid())
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True, sa_type=sa.Uuid())
    account_id: uuid.UUID = Field(foreign_key="accounts.id", index=True, sa_type=sa.Uuid())
    category_id: uuid.UUID | None = Field(
        default=None, foreign_key="categories.id", index=True, nullable=True, sa_type=sa.Uuid()
    )
    kind: str = Field(max_length=10, sa_type=sa.String(10))
    amount_cents: int = Field(description="Sempre positivo; o tipo (kind) diz se entra ou sai.")
    occurred_on: date = Field(index=True, sa_type=sa.Date())
    description: str = Field(max_length=200, sa_type=sa.String(200))
    notes: str | None = Field(default=None, nullable=True, sa_type=sa.Text())
    # Transferência: os dois lançamentos (saída e entrada) compartilham o mesmo grupo.
    transfer_group_id: uuid.UUID | None = Field(
        default=None, index=True, nullable=True, sa_type=sa.Uuid()
    )
    # Compra parcelada: as parcelas compartilham o grupo; número e total ficam aqui.
    installment_group_id: uuid.UUID | None = Field(
        default=None, index=True, nullable=True, sa_type=sa.Uuid()
    )
    installment_number: int | None = Field(default=None, nullable=True)
    installment_total: int | None = Field(default=None, nullable=True)
