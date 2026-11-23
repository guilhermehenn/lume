"""Arquivo do cofre (SQLite): esquema, migrações e leitura/gravação dos dados.

Cada cofre é um arquivo autocontido, como um documento. O esquema evolui por
migrações numeradas guardadas em ``PRAGMA user_version``; antes de migrar, o
bootstrap faz um backup. O SQL usado aqui (INSERT … ON CONFLICT DO UPDATE)
também roda em PostgreSQL, para o dia em que o Lume for para a nuvem.
"""

from __future__ import annotations

import contextlib
import dataclasses
import functools
import json
import sqlite3
import sys
import time
from collections.abc import Callable, Hashable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from pydantic.alias_generators import to_camel

from app.vaults import models

SCHEMA_VERSION = 2
#: Marca no cabeçalho do arquivo ("LUME"), para reconhecer um cofre mesmo fora da pasta.
APPLICATION_ID = 0x4C554D45

_MIGRATIONS: dict[int, str] = {
    1: """
    CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE owner (
        id                  TEXT PRIMARY KEY,
        first_name          TEXT NOT NULL,
        last_name           TEXT NOT NULL DEFAULT '',
        email               TEXT NOT NULL,
        photo               TEXT,
        password_hash       TEXT NOT NULL,
        key_wrap            TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        password_changed_at TEXT NOT NULL
    );
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE mail_settings (
        id           INTEGER PRIMARY KEY CHECK (id = 1),
        provider     TEXT NOT NULL,
        host         TEXT NOT NULL,
        port         INTEGER NOT NULL,
        security     TEXT NOT NULL,
        username     TEXT NOT NULL,
        from_name    TEXT NOT NULL DEFAULT '',
        password_enc TEXT,
        updated_at   TEXT NOT NULL
    );
    CREATE TABLE banks (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        code            TEXT,
        kind            TEXT NOT NULL,
        color           TEXT NOT NULL,
        initial_balance INTEGER NOT NULL,
        is_primary      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    );
    CREATE TABLE categories (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
        name_key   TEXT,
        name       TEXT,
        icon       TEXT NOT NULL,
        color      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE transactions (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
        amount         INTEGER NOT NULL CHECK (amount > 0),
        date           TEXT NOT NULL,
        bank_id        TEXT NOT NULL REFERENCES banks (id),
        category_id    TEXT NOT NULL REFERENCES categories (id),
        counterparty   TEXT NOT NULL,
        payment_method TEXT,
        note           TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
    );
    CREATE INDEX ix_transactions_date ON transactions (date);
    CREATE INDEX ix_transactions_bank ON transactions (bank_id);
    CREATE INDEX ix_transactions_category ON transactions (category_id);
    CREATE TABLE investments (
        id               TEXT PRIMARY KEY,
        operation        TEXT NOT NULL,
        type             TEXT NOT NULL,
        amount           INTEGER NOT NULL CHECK (amount > 0),
        date             TEXT NOT NULL,
        bank_id          TEXT NOT NULL REFERENCES banks (id),
        asset            TEXT NOT NULL,
        quantity         REAL,
        unit_price       INTEGER,
        fees             INTEGER,
        issuer           TEXT,
        issuer_cnpj      TEXT,
        indexer          TEXT,
        rate             TEXT,
        maturity         TEXT,
        daily_liquidity  INTEGER,
        incentivized     INTEGER,
        fixed_income_etf INTEGER,
        fund_class       TEXT,
        plan             TEXT,
        crypto_class     TEXT,
        treasury_title   TEXT,
        earning_kind     TEXT,
        tax_withheld     INTEGER,
        note             TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
    );
    CREATE INDEX ix_investments_date ON investments (date);
    CREATE INDEX ix_investments_bank ON investments (bank_id);
    CREATE TABLE reports (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        filters    TEXT NOT NULL,
        group_by   TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """,
    # v0.3.1: código de recuperação do dono, um só banco principal garantido pelo próprio
    # banco de dados (não só pelo app) e a marca do arquivo.
    2: """
    ALTER TABLE owner ADD COLUMN recovery_hash TEXT;
    ALTER TABLE owner ADD COLUMN recovery_wrap TEXT;
    ALTER TABLE owner ADD COLUMN recovery_created_at TEXT;
    ALTER TABLE owner ADD COLUMN recovery_confirmed_at TEXT;
    UPDATE banks SET is_primary = 0
     WHERE is_primary = 1 AND rowid NOT IN (SELECT MIN(rowid) FROM banks WHERE is_primary = 1);
    CREATE UNIQUE INDEX ux_banks_one_primary ON banks (is_primary) WHERE is_primary = 1;
    PRAGMA application_id = 1280658757;
    """,
}

_BOOL_COLUMNS = {"is_primary", "daily_liquidity", "incentivized", "fixed_income_etf"}
_JSON_COLUMNS = {"filters"}


class VaultError(Exception):
    """Problema no arquivo do cofre. ``code`` vai para a API."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


class RevisionConflict(VaultError):
    def __init__(self, current: int) -> None:
        super().__init__("conflict", f"o cofre está na revisão {current}")
        self.current = current


class InvalidData(VaultError):
    def __init__(self, detail: str) -> None:
        super().__init__("invalid", detail)


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


# ---------------------------------------------------------------- conexão e esquema


@contextlib.contextmanager
def connect(path: Path, *, readonly: bool = False) -> Iterator[sqlite3.Connection]:
    """Abre o arquivo do cofre.

    - ``timeout=10``: espera até 10 s se outra conexão estiver gravando (busy timeout).
    - WAL: leituras não esperam gravações; ``synchronous=FULL`` porque são dados financeiros:
      uma gravação confirmada sobrevive a queda de energia (o custo é pequeno, gravações
      aqui são poucas e pequenas).
    - ``foreign_keys=ON`` em toda conexão (no SQLite vem desligado).
    """
    # Windows pode demorar a liberar a memória compartilhada de um processo encerrado.
    # O SQLite anterior à correção 7c103a0b7d pode devolver SQLITE_IOERR_TRUNCATE
    # durante essa janela. Tentar apenas a abertura, sem repetir operações do usuário.
    deadline = time.monotonic() + 3.0
    while True:
        conn = None
        try:
            if readonly:
                conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
            else:
                conn = sqlite3.connect(path, timeout=10, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            if not readonly:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=FULL")
        except BaseException as exc:
            if conn is not None:
                conn.close()
            if (
                sys.platform != "win32"
                or not isinstance(exc, sqlite3.OperationalError)
                or getattr(exc, "sqlite_errorcode", None) != sqlite3.SQLITE_IOERR_TRUNCATE
            ):
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(0.05, remaining))
        else:
            break
    try:
        yield conn
    finally:
        conn.close()


@contextlib.contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    try:
        conn.execute("COMMIT")
    except BaseException:
        # COMMIT pode falhar (chave estrangeira adiada, disco cheio): desfaz tudo.
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def schema_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def migrate(conn: sqlite3.Connection) -> int:
    """Aplica as migrações pendentes. Retorna quantas foram aplicadas."""
    current = schema_version(conn)
    if current > SCHEMA_VERSION:
        raise VaultError("too-new", "Este cofre foi criado por uma versão mais nova do Lume.")
    applied = 0
    for version in range(current + 1, SCHEMA_VERSION + 1):
        with transaction(conn):
            for statement in _split_sql(_MIGRATIONS[version]):
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version = {version}")
        applied += 1
    return applied


def _split_sql(script: str) -> list[str]:
    """Separa o script em comandos completos (um ";" dentro de texto não corta o comando)."""
    statements: list[str] = []
    buffer = ""
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statements.append(buffer.strip())
            buffer = ""
    if buffer.strip():
        statements.append(buffer.strip())
    return statements


# ---------------------------------------------------------------- meta e configurações


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def revision(conn: sqlite3.Connection) -> int:
    return int(get_meta(conn, "revision", "0") or 0)


def read_settings(conn: sqlite3.Connection) -> dict[str, Any]:
    """As configurações gravadas sobre as de fábrica, conferidas uma a uma.

    Um valor estragado (editado à mão, de uma versão futura) volta ao de fábrica sozinho. Antes,
    um valor ruim fazia todas as outras voltarem ao padrão junto (idioma, tema, moeda...).
    Chaves desconhecidas ficam no arquivo, intactas, e não aparecem.
    """
    merged = models.VaultSettings().model_dump()
    for row in conn.execute("SELECT key, value FROM settings"):
        key = row["key"]
        if key not in merged:
            continue
        try:
            checked = models.VaultSettings(**{**merged, key: json.loads(row["value"])})
        except (ValueError, ValidationError):
            continue
        merged[key] = getattr(checked, key)
    return models.VaultSettings(**merged).model_dump(by_alias=True)


def write_settings(
    conn: sqlite3.Connection, patch: models.SettingsPatch, *, in_transaction: bool = False
) -> dict[str, Any]:
    """Grava só os campos enviados. ``in_transaction``: já dentro de uma transação aberta."""
    with contextlib.nullcontext(conn) if in_transaction else transaction(conn):
        for key, value in patch.model_dump(exclude_none=True).items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
    return read_settings(conn)


# ---------------------------------------------------------------- dados (bancos, lançamentos…)


def _columns(collection: str) -> list[str]:
    return list(models.ENTITY_MODELS[collection].model_fields)


def _to_row(collection: str, item: models._Model) -> dict[str, Any]:
    row = item.model_dump(by_alias=False)
    for key, value in row.items():
        if key in _BOOL_COLUMNS and value is not None:
            row[key] = 1 if value else 0
        elif key in _JSON_COLUMNS:
            row[key] = json.dumps(item.filters.model_dump(by_alias=True, exclude_none=True))  # type: ignore[attr-defined]
    return row


@functools.cache
def _reader(collection: str) -> tuple[str, tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    """SQL e nomes (já em camelCase) de cada coleção, calculados uma vez só.

    Converter o nome de cada coluna em cada linha custava mais que a própria leitura: com
    100 mil lançamentos, eram 1,1 milhão de conversões a cada abertura do cofre.
    """
    cols = _columns(collection)
    sql = f"SELECT {', '.join(cols)} FROM {collection} ORDER BY rowid"  # noqa: S608 - nomes fixos
    names = tuple(to_camel(c) for c in cols)
    bools = tuple(to_camel(c) for c in cols if c in _BOOL_COLUMNS)
    jsons = tuple(to_camel(c) for c in cols if c in _JSON_COLUMNS)
    return sql, names, bools, jsons


def read_state(conn: sqlite3.Connection) -> dict[str, Any]:
    state: dict[str, Any] = {"version": 1}
    for collection in models.COLLECTIONS:
        sql, names, bools, jsons = _reader(collection)
        cursor = conn.cursor()
        cursor.row_factory = None  # tuplas: bem mais rápido que sqlite3.Row
        items = []
        for row in cursor.execute(sql):
            item = {
                name: value for name, value in zip(names, row, strict=True) if value is not None
            }
            for key in bools:
                if key in item:
                    item[key] = bool(item[key])
            for key in jsons:
                if key in item:
                    item[key] = json.loads(item[key])
            items.append(item)
        state[collection] = items
    return state


def read_snapshot(conn: sqlite3.Connection) -> tuple[int, dict[str, Any]]:
    """Revisão e dados lidos do **mesmo** instante.

    Sem uma transação de leitura, cada SELECT enxerga o arquivo do seu próprio momento: uma
    gravação de outra aba no meio da leitura podia trazer a revisão antiga com dados novos, ou
    lançamentos que apontam para um banco que a leitura de bancos (feita antes) não viu.
    """
    conn.execute("BEGIN")
    try:
        return revision(conn), read_state(conn)
    finally:
        conn.execute("COMMIT")


def _validate(collection: str, items: list[dict]) -> list[models._Model]:
    model = models.ENTITY_MODELS[collection]
    out = []
    for index, item in enumerate(items):
        try:
            out.append(model.model_validate(item))
        except ValidationError as exc:
            first = exc.errors()[0]
            where = ".".join(str(p) for p in first.get("loc", ()))
            raise InvalidData(f"{collection}[{index}].{where}: {first.get('msg')}") from exc
    return out


def _upsert(conn: sqlite3.Connection, collection: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    cols = _columns(collection)
    placeholders = ", ".join("?" for _ in cols)
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "id")
    sql = (
        f"INSERT INTO {collection} ({', '.join(cols)}) VALUES ({placeholders}) "  # noqa: S608 - nomes fixos
        f"ON CONFLICT (id) DO UPDATE SET {updates}"
    )
    if collection == "banks":
        # Um só banco principal é garantido por índice único, conferido a cada linha: quem
        # deixa de ser principal precisa ser gravado antes de quem passa a ser.
        rows = sorted(rows, key=lambda r: bool(r.get("is_primary")))
    try:
        conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
    except sqlite3.IntegrityError as exc:
        if "is_primary" in str(exc):
            raise InvalidData("banks: mais de um banco principal") from exc
        raise InvalidData(f"{collection}: {exc}") from exc


def _category_row_key(row: sqlite3.Row) -> tuple[str, ...]:
    name = (row["name"] or "").strip()
    if name:
        return (row["kind"], "nome", models.text_key(name))
    return (row["kind"], "catalogo", row["name_key"] or "")


@dataclass(frozen=True)
class _NameRule:
    """Nome que não pode se repetir numa coleção, comparado sem acento e sem maiúsculas."""

    select: str
    row_key: Callable[[sqlite3.Row], Hashable]
    item_key: Callable[[Any], Hashable]
    label: Callable[[Any], str]
    message: str


_NAME_RULES: dict[str, _NameRule] = {
    "banks": _NameRule(
        "SELECT id, name FROM banks",
        lambda row: models.text_key(row["name"]),
        lambda bank: models.text_key(bank.name),
        lambda bank: bank.name,
        "já existe um banco com o nome {!r}",
    ),
    # Categorias: dentro de cada tipo; pelo nome dado ou pela chave do catálogo. O nome traduzido
    # das categorias do app depende do idioma e é comparado no navegador.
    "categories": _NameRule(
        "SELECT id, kind, name, name_key FROM categories",
        _category_row_key,
        lambda category: (category.kind, *models.category_key(category)),
        lambda category: category.name or category.name_key,
        "já existe uma categoria desse tipo com o nome {!r}",
    ),
    "reports": _NameRule(
        "SELECT id, name FROM reports",
        lambda row: models.text_key(row["name"]),
        lambda report: models.text_key(report.name),
        lambda report: report.name,
        "já existe um relatório com o nome {!r}",
    ),
}


def _check_names(
    conn: sqlite3.Connection, validated: dict[str, list], changes: models.Changes
) -> None:
    """Nomes repetidos, conferidos antes de gravar com o que já está no cofre.

    O que sai no mesmo lote não conta, e trocar nomes entre dois registros numa gravação só vale.
    Uma repetição vinda de versão anterior não trava a edição daquele registro enquanto o nome não
    muda: a regra barra nomes novos.
    """
    for collection, rule in _NAME_RULES.items():
        items = validated.get(collection) or []
        if not items:
            continue
        deleted = set(changes.deletes.get(collection) or [])  # type: ignore[call-overload]
        before = {
            row["id"]: rule.row_key(row)
            for row in conn.execute(rule.select)
            if row["id"] not in deleted
        }
        after = dict(before)
        after.update({item.id: rule.item_key(item) for item in items})
        holders: dict[Hashable, int] = {}
        for key in after.values():
            holders[key] = holders.get(key, 0) + 1
        for item in items:
            key = after[item.id]
            if before.get(item.id) != key and holders[key] > 1:
                raise InvalidData(f"{collection}: " + rule.message.format(rule.label(item)))


def _check_report_refs(conn: sqlite3.Connection, reports: list[models.Report]) -> None:
    """Relatório salvo só filtra por banco e categoria que existem (conferido depois de gravar)."""
    for table, ids in (
        ("banks", {i for r in reports for i in r.filters.bank_ids}),
        ("categories", {i for r in reports for i in r.filters.category_ids}),
    ):
        if not ids:
            continue
        found = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE id IN (SELECT value FROM json_each(?))",  # noqa: S608
            (json.dumps(sorted(ids)),),
        ).fetchone()[0]
        if found != len(ids):
            what = "banco" if table == "banks" else "categoria"
            raise InvalidData(f"reports: filtro com {what} que não existe")


def _check_limits(conn: sqlite3.Connection, changes: models.Changes) -> None:
    """Os tetos do backup também valem ao gravar: um cofre maior não poderia ser restaurado."""
    for collection, items in changes.upserts.items():
        if not items:
            continue
        limit = models.MAX_ITEMS[collection]
        total = int(conn.execute(f"SELECT COUNT(*) FROM {collection}").fetchone()[0])  # noqa: S608
        if total > limit:
            raise InvalidData(f"{collection}: o cofre passaria de {limit} registros")


#: Acima disto, conferir o conjunto inteiro sai mais barato que conferir item a item.
_TARGETED_LIMIT = 500


def _check_integrity(conn: sqlite3.Connection, changes: models.Changes | None = None) -> None:
    """Regras que valem para o conjunto, conferidas antes de gravar (mensagem clara para a
    interface). O próprio SQLite confere as chaves estrangeiras de novo no COMMIT.

    Com poucas mudanças, só os itens afetados são conferidos: gravar 1 lançamento custa o
    mesmo com 1 mil ou 100 mil lançamentos no cofre.
    """
    if changes is None or _size(changes) > _TARGETED_LIMIT:
        _check_everything(conn)
        return
    ids = {name: json.dumps(items) for name, items in changes.deletes.items() if items}
    ids.update(
        {
            f"up_{name}": json.dumps([str(item.get("id")) for item in items])
            for name, items in changes.upserts.items()
            if items
        }
    )
    checks = [
        (
            "up_transactions",
            "SELECT 1 FROM transactions t WHERE t.id IN (SELECT value FROM json_each(?))"
            " AND (NOT EXISTS (SELECT 1 FROM banks b WHERE b.id = t.bank_id)"
            " OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = t.category_id)) LIMIT 1",
            "transactions: referência a um banco ou categoria que não existe",
        ),
        (
            "up_transactions",
            "SELECT 1 FROM transactions t JOIN categories c ON c.id = t.category_id"
            " WHERE t.id IN (SELECT value FROM json_each(?)) AND c.kind <> t.kind LIMIT 1",
            "transactions: categoria de outro tipo",
        ),
        (
            "up_investments",
            "SELECT 1 FROM investments i WHERE i.id IN (SELECT value FROM json_each(?))"
            " AND NOT EXISTS (SELECT 1 FROM banks b WHERE b.id = i.bank_id) LIMIT 1",
            "investments: referência a um banco que não existe",
        ),
        (
            "banks",
            "SELECT 1 FROM transactions WHERE bank_id IN (SELECT value FROM json_each(?1))"
            " UNION ALL"
            " SELECT 1 FROM investments WHERE bank_id IN (SELECT value FROM json_each(?1))"
            " LIMIT 1",
            "banks: banco excluído ainda tem lançamentos",
        ),
        (
            "categories",
            "SELECT 1 FROM transactions WHERE category_id IN (SELECT value FROM json_each(?))"
            " LIMIT 1",
            "categories: categoria excluída ainda tem lançamentos",
        ),
        (
            "up_categories",
            "SELECT 1 FROM transactions t JOIN categories c ON c.id = t.category_id"
            " WHERE c.id IN (SELECT value FROM json_each(?)) AND c.kind <> t.kind LIMIT 1",
            "transactions: categoria de outro tipo",
        ),
    ]
    for key, sql, message in checks:
        if key in ids and conn.execute(sql, (ids[key],)).fetchone():
            raise InvalidData(message)


def _check_everything(conn: sqlite3.Connection) -> None:
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        table = violations[0][0]
        raise InvalidData(f"{table}: referência a um banco ou categoria que não existe")
    wrong_kind = conn.execute(
        "SELECT t.id FROM transactions t JOIN categories c ON c.id = t.category_id"
        " WHERE c.kind <> t.kind LIMIT 1"
    ).fetchone()
    if wrong_kind:
        raise InvalidData("transactions: categoria de outro tipo")


def _size(changes: models.Changes) -> int:
    return sum(len(v) for v in changes.upserts.values()) + sum(
        len(v) for v in changes.deletes.values()
    )


#: Regras dos formulários do app, conferidas no que é digitado agora (não em backups restaurados).
_FORM_RULES: tuple[tuple[str, Any], ...] = (
    ("investments", models.investment_rules),
    ("banks", models.bank_rules),
    ("categories", models.category_rules),
    ("reports", models.report_rules),
)


def apply_changes(conn: sqlite3.Connection, changes: models.Changes) -> int:
    """Grava as diferenças numa transação só. Retorna a nova revisão.

    Se o navegador estava numa revisão antiga (outra aba gravou antes), nada é gravado
    e ``RevisionConflict`` diz a revisão atual, para o front recarregar.
    """
    validated = {name: _validate(name, items) for name, items in changes.upserts.items()}
    rules = () if changes.restore else _FORM_RULES
    for collection, rule in rules:
        for index, item in enumerate(validated.get(collection, [])):  # type: ignore[call-overload]
            try:
                rule(item)
            except ValueError as exc:
                raise InvalidData(f"{collection}[{index}]: {exc}") from exc
    try:
        with transaction(conn):
            current = revision(conn)
            if changes.base_revision != current:
                raise RevisionConflict(current)
            conn.execute("PRAGMA defer_foreign_keys = ON")
            if not changes.restore:
                _check_names(conn, validated, changes)  # type: ignore[arg-type]
            # Exclusões primeiro (lançamentos antes de bancos e categorias), depois o resto.
            for collection in ("transactions", "investments", "reports", "categories", "banks"):
                ids = changes.deletes.get(collection) or []  # type: ignore[call-overload]
                if ids:
                    conn.executemany(f"DELETE FROM {collection} WHERE id = ?", [(i,) for i in ids])  # noqa: S608
            for collection in ("banks", "categories", "transactions", "investments", "reports"):
                items = validated.get(collection) or []  # type: ignore[call-overload]
                _upsert(conn, collection, [_to_row(collection, item) for item in items])
            _check_limits(conn, changes)
            _check_integrity(conn, changes)
            if not changes.restore:
                _check_report_refs(conn, validated.get("reports") or [])  # type: ignore[arg-type]
            new_revision = current + 1
            set_meta(conn, "revision", str(new_revision))
            set_meta(conn, "updated_at", utcnow())
    except sqlite3.IntegrityError as exc:
        # Última barreira: o SQLite recusou no COMMIT algo que as conferências não pegaram.
        raise InvalidData(f"dados inconsistentes: {exc}") from exc
    return new_revision


def replace_state(conn: sqlite3.Connection, state: models.DataState) -> int:
    """Troca todos os dados (usado ao criar o cofre com dados importados)."""
    with transaction(conn):
        conn.execute("PRAGMA defer_foreign_keys = ON")
        for collection in ("transactions", "investments", "reports", "categories", "banks"):
            conn.execute(f"DELETE FROM {collection}")  # noqa: S608 - nomes fixos
        for collection in ("banks", "categories", "transactions", "investments", "reports"):
            items = getattr(state, collection)
            _upsert(conn, collection, [_to_row(collection, item) for item in items])
        _check_integrity(conn)
        new_revision = revision(conn) + 1
        set_meta(conn, "revision", str(new_revision))
        set_meta(conn, "updated_at", utcnow())
    return new_revision


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    out = {}
    for name in models.COLLECTIONS:  # nomes fixos, nunca vindos de fora
        out[name] = int(conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0])  # noqa: S608
    return out


# ---------------------------------------------------------------- dono do cofre


@dataclass(frozen=True)
class Owner:
    id: str
    first_name: str
    last_name: str
    email: str
    photo: str | None
    password_hash: str
    key_wrap: str
    created_at: str
    updated_at: str
    password_changed_at: str
    recovery_hash: str | None = None
    recovery_wrap: str | None = None
    recovery_created_at: str | None = None
    recovery_confirmed_at: str | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "email": self.email,
            "photo": self.photo,
            "createdAt": self.created_at,
            "passwordChangedAt": self.password_changed_at,
            "recovery": {
                "createdAt": self.recovery_created_at if self.recovery_wrap else None,
                "confirmed": bool(self.recovery_wrap and self.recovery_confirmed_at),
            },
        }


def read_owner(conn: sqlite3.Connection) -> Owner:
    row = conn.execute("SELECT * FROM owner LIMIT 1").fetchone()
    if row is None:
        raise VaultError("no-owner", "O cofre não tem dono cadastrado.")
    # Só as colunas conhecidas: um cofre de versão futura pode ter colunas a mais.
    present = set(row.keys())
    return Owner(**{f.name: row[f.name] for f in dataclasses.fields(Owner) if f.name in present})


def insert_owner(conn: sqlite3.Connection, owner: Owner) -> None:
    fields = dataclasses.asdict(owner)
    columns = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    conn.execute(f"INSERT INTO owner ({columns}) VALUES ({marks})", tuple(fields.values()))  # noqa: S608 - colunas do dataclass


def update_owner(conn: sqlite3.Connection, **fields: Any) -> Owner:
    allowed = {
        "first_name",
        "last_name",
        "email",
        "photo",
        "password_hash",
        "key_wrap",
        "password_changed_at",
        "recovery_hash",
        "recovery_wrap",
        "recovery_created_at",
        "recovery_confirmed_at",
    }
    unknown = set(fields) - allowed
    if unknown:  # pragma: no cover - erro de programação
        raise ValueError(f"campos não permitidos: {unknown}")
    fields["updated_at"] = utcnow()
    assignments = ", ".join(f"{k} = ?" for k in fields)
    with transaction(conn):
        conn.execute(f"UPDATE owner SET {assignments}", tuple(fields.values()))  # noqa: S608 - chaves conferidas
    return read_owner(conn)


# ---------------------------------------------------------------- e-mail de envio


def read_mail(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM mail_settings WHERE id = 1").fetchone()
    return dict(row) if row else None


def write_mail(conn: sqlite3.Connection, data: dict[str, Any]) -> None:
    with transaction(conn):
        conn.execute(
            "INSERT INTO mail_settings (id, provider, host, port, security, username, from_name,"
            " password_enc, updated_at) VALUES (1, :provider, :host, :port, :security, :username,"
            " :from_name, :password_enc, :updated_at) ON CONFLICT (id) DO UPDATE SET"
            " provider = excluded.provider, host = excluded.host,"
            " port = excluded.port, security = excluded.security, username = excluded.username,"
            " from_name = excluded.from_name, password_enc = excluded.password_enc,"
            " updated_at = excluded.updated_at",
            {**data, "updated_at": utcnow()},
        )


def delete_mail(conn: sqlite3.Connection) -> None:
    with transaction(conn):
        conn.execute("DELETE FROM mail_settings")
