"""Validação dos dados que chegam do front-end (mesmas regras do zod de src/data/backup.ts).

Os nomes em Python são snake_case (iguais às colunas do SQLite); no JSON, camelCase.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
from pydantic.alias_generators import to_camel

MAX_CENTS = 9_999_999_999_999
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COLOR_RE = r"^#[0-9a-fA-F]{6}$"


#: Datas aceitas (lançamentos e vencimentos). Evita "0026" ou "20260" digitados por engano.
MIN_YEAR, MAX_YEAR = 1900, 2199


def _iso_date(value: str) -> str:
    if not _ISO_RE.match(value):
        raise ValueError("data inválida")
    parsed = date.fromisoformat(value)  # rejeita 2026-02-30
    if not MIN_YEAR <= parsed.year <= MAX_YEAR:
        raise ValueError(f"ano fora de {MIN_YEAR}–{MAX_YEAR}")
    return value


Id = Annotated[str, Field(min_length=1, max_length=64)]
IsoDate = Annotated[str, AfterValidator(_iso_date)]
#: Data e hora ISO 8601 como o navegador gera (``toISOString``): ordena os lançamentos do mesmo
#: dia. Texto qualquer ("ontem") embaralharia a ordem e não volta a ser comparável.
_STAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$"
)


def _stamp(value: str) -> str:
    if not _STAMP_RE.match(value):
        raise ValueError("data e hora inválidas")
    datetime.fromisoformat(value)  # rejeita 2026-02-30T10:00 e 25:00
    return value


Stamp = Annotated[str, Field(max_length=40), AfterValidator(_stamp)]
Color = Annotated[str, Field(pattern=_COLOR_RE)]
Cents = Annotated[int, Field(ge=0, le=MAX_CENTS)]
PositiveCents = Annotated[int, Field(gt=0, le=MAX_CENTS)]
Kind = Literal["expense", "income"]
#: Texto obrigatório: espaços nas pontas saem e só espaços não vale.
Text120 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class _Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", strict=False
    )


class Bank(_Model):
    id: Id
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    code: Annotated[str, Field(pattern=r"^\d{0,3}$")] | None = None
    kind: Literal["checking", "digital", "savings", "broker", "cash", "other"]
    color: Color
    initial_balance: Annotated[int, Field(ge=-MAX_CENTS, le=MAX_CENTS)]
    is_primary: bool
    created_at: Stamp
    updated_at: Stamp


class Category(_Model):
    id: Id
    kind: Kind
    name_key: Annotated[str, Field(max_length=40)] | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None
    icon: Annotated[str, Field(min_length=1, max_length=30)]
    color: Color
    created_at: Stamp
    updated_at: Stamp


class Transaction(_Model):
    id: Id
    kind: Kind
    amount: PositiveCents
    date: IsoDate
    bank_id: Id
    category_id: Id
    counterparty: Text120
    payment_method: Literal["pix", "debit", "credit", "boleto", "cash", "transfer"] | None = None
    note: Annotated[str, Field(max_length=500)] | None = None
    created_at: Stamp
    updated_at: Stamp

    @model_validator(mode="after")
    def _payment_only_for_expenses(self) -> Transaction:
        if self.kind == "income" and self.payment_method is not None:
            raise ValueError("forma de pagamento só vale para despesas")
        return self


class Investment(_Model):
    id: Id
    operation: Literal["contribution", "redemption", "earning"]
    type: Literal[
        "savings",
        "cdb",
        "lci_lca",
        "cri_cra",
        "debenture",
        "treasury",
        "stock",
        "fii",
        "fiagro",
        "etf",
        "bdr",
        "fund",
        "pension",
        "crypto",
        "gold",
        "other",
    ]
    amount: PositiveCents
    date: IsoDate
    bank_id: Id
    asset: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    quantity: Annotated[float, Field(gt=0, lt=1e15)] | None = None
    unit_price: Cents | None = None
    fees: Cents | None = None
    issuer: Annotated[str, Field(max_length=80)] | None = None
    issuer_cnpj: Annotated[str, Field(max_length=18)] | None = None
    indexer: Literal["cdi", "ipca", "prefixed", "selic", "other"] | None = None
    rate: Annotated[str, Field(max_length=30)] | None = None
    maturity: IsoDate | None = None
    daily_liquidity: bool | None = None
    incentivized: bool | None = None
    fixed_income_etf: bool | None = None
    fund_class: Literal["fixed", "multi", "equity"] | None = None
    plan: Literal["pgbl", "vgbl"] | None = None
    crypto_class: Literal["bitcoin", "altcoin", "stablecoin"] | None = None
    treasury_title: Literal["selic", "ipca", "prefixed", "renda", "educa"] | None = None
    earning_kind: Literal["dividend", "jcp", "interest", "fii_income", "other"] | None = None
    tax_withheld: Cents | None = None
    note: Annotated[str, Field(max_length=500)] | None = None
    created_at: Stamp
    updated_at: Stamp


#: Tipos que usam quantidade × preço (como ``quantityBased`` em src/data/investments.ts).
QUANTITY_TYPES = frozenset({"treasury", "stock", "fii", "fiagro", "etf", "bdr", "crypto", "gold"})

# CNPJ: desde 31/07/2026 as 12 primeiras posições podem ter letras; os dígitos verificadores
# continuam numéricos. Módulo 11 com cada caractere valendo o código ASCII − 48.
_CNPJ_RE = re.compile(r"^[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}/?[0-9A-Z]{4}-?\d{2}$")


def valid_cnpj(value: str) -> bool:
    text = value.strip().upper()
    if not _CNPJ_RE.match(text):
        return False
    chars = re.sub(r"[^0-9A-Z]", "", text)
    if len(set(chars)) == 1:
        return False
    digits = [ord(c) - 48 for c in chars]

    def check(length: int) -> int:
        weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2][13 - length :]
        rest = sum(w * d for w, d in zip(weights, digits[:length], strict=True)) % 11
        return 0 if rest < 2 else 11 - rest

    return check(12) == digits[12] and check(13) == digits[13]


_BANK_CODE_RE = re.compile(r"^\d{3}$")


def text_key(name: str) -> str:
    """Nome para comparar (bancos, categorias, relatórios): sem acento, sem diferença de maiúsculas
    e com espaços simples, como ``normalize`` em src/lib/text.ts: "Itau" e "ITAÚ" são o mesmo."""
    plain = unicodedata.normalize("NFD", name)
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return " ".join(plain.casefold().split())


def bank_rules(bank: Bank) -> None:
    """Regras do formulário de banco conferidas no servidor (só em gravações novas, como as dos
    investimentos): código COMPE sempre com 3 dígitos ("001", não "1")."""
    if bank.code and not _BANK_CODE_RE.match(bank.code):
        raise ValueError("código do banco precisa ter 3 dígitos")


#: Categorias que vêm com o app (``CATEGORY_CATALOG`` em src/data/catalog.ts; um teste confere).
CATEGORY_KEYS = frozenset(
    {
        "housing",
        "groceries",
        "restaurants",
        "transport",
        "health",
        "education",
        "leisure",
        "shopping",
        "subscriptions",
        "bills",
        "travel",
        "pets",
        "gifts",
        "taxes",
        "personal_care",
        "other_expense",
        "salary",
        "freelance",
        "investment_income",
        "refunds",
        "sales",
        "gifts_received",
        "rent_received",
        "other_income",
    }
)


def category_key(category: Category) -> tuple[str, str]:
    """Como a categoria é comparada com as outras do mesmo tipo: pelo nome dado (sem acento e
    sem diferença de maiúsculas) ou, se veio com o app, pela chave do catálogo."""
    if category.name:
        return ("nome", text_key(category.name))
    return ("catalogo", category.name_key or "")


def category_rules(category: Category) -> None:
    """Regras do formulário de categoria conferidas no servidor (só em gravações novas)."""
    if not category.name and not category.name_key:
        raise ValueError("categoria sem nome")
    if category.name_key is not None and category.name_key not in CATEGORY_KEYS:
        raise ValueError("categoria do catálogo desconhecida")


def report_rules(report: Report) -> None:
    """Regras do relatório salvo conferidas no servidor (só em gravações novas): período em ordem
    e filtros sem repetição. Bancos e categorias que não existem são conferidos com o cofre."""
    f = report.filters
    if f.from_ and f.to and f.from_ > f.to:
        raise ValueError("período começa depois de terminar")
    for label, values in (
        ("tipos", f.kinds),
        ("bancos", f.bank_ids),
        ("categorias", f.category_ids),
    ):
        if len(values) != len(set(values)):
            raise ValueError(f"filtro com {label} repetidos")


def investment_rules(inv: Investment) -> None:
    """Regras de cada operação que o formulário do app já segue, conferidas também no servidor.

    Valem para gravações novas (``POST /api/vault/changes``). A importação de um cofre antigo
    não passa por aqui, para não recusar dados de versões anteriores por detalhes.
    """
    earning = inv.operation == "earning"
    if inv.type in QUANTITY_TYPES and not earning and not inv.quantity:
        raise ValueError("quantidade obrigatória para este tipo")
    if earning and any(v is not None for v in (inv.quantity, inv.unit_price, inv.fees)):
        raise ValueError("rendimento não tem quantidade, preço nem taxas")
    if not earning and (inv.earning_kind is not None or inv.tax_withheld is not None):
        raise ValueError("tipo de rendimento e IR retido só valem para rendimentos")
    if inv.tax_withheld and inv.tax_withheld > inv.amount:
        raise ValueError("IR retido maior que o rendimento")
    if inv.operation == "contribution" and inv.fees and inv.fees > inv.amount:
        raise ValueError("taxas maiores que o valor da aplicação")
    if inv.type == "treasury" and inv.treasury_title is None:
        raise ValueError("título do Tesouro obrigatório")
    if inv.issuer_cnpj and not valid_cnpj(inv.issuer_cnpj):
        raise ValueError("CNPJ inválido")


class ReportFilters(_Model):
    from_: IsoDate | None = Field(default=None, alias="from")
    to: IsoDate | None = None
    #: Período relativo ("Este mês"): ao abrir o relatório, as datas são as do dia (v0.3.8).
    preset: Literal["thisMonth", "lastMonth", "last3", "last12", "thisYear", "lastYear"] | None = (
        None
    )
    kinds: list[Kind] = Field(max_length=2)
    category_ids: list[Id] = Field(max_length=500)
    bank_ids: list[Id] = Field(max_length=500)
    text: Annotated[str, Field(max_length=120)] | None = None


class Report(_Model):
    id: Id
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    filters: ReportFilters
    group_by: Literal["category", "bank", "month", "counterparty"]
    created_at: Stamp


ENTITY_MODELS: dict[str, type[_Model]] = {
    "banks": Bank,
    "categories": Category,
    "transactions": Transaction,
    "investments": Investment,
    "reports": Report,
}
COLLECTIONS = tuple(ENTITY_MODELS)


#: Quantos registros cabem num cofre. Os mesmos tetos valem ao importar um backup e ao gravar,
#: para que todo cofre possa ser exportado e restaurado depois (src/data/backup.ts usa os mesmos).
MAX_ITEMS: dict[str, int] = {
    "banks": 500,
    "categories": 500,
    "transactions": 200_000,
    "investments": 100_000,
    "reports": 200,
}


class DataState(_Model):
    version: Literal[1] = 1
    banks: list[Bank] = Field(default_factory=list, max_length=MAX_ITEMS["banks"])
    categories: list[Category] = Field(default_factory=list, max_length=MAX_ITEMS["categories"])
    transactions: list[Transaction] = Field(
        default_factory=list, max_length=MAX_ITEMS["transactions"]
    )
    investments: list[Investment] = Field(default_factory=list, max_length=MAX_ITEMS["investments"])
    reports: list[Report] = Field(default_factory=list, max_length=MAX_ITEMS["reports"])


class Changes(_Model):
    """Diferenças entre o estado que o navegador tinha e o novo, aplicadas de uma vez."""

    base_revision: int = Field(ge=0)
    #: Dados que já existiam (backup restaurado, "Desfazer"): valem a integridade e os tetos de
    #: sempre, mas não as regras dos formulários, que mudam de versão para versão. É o mesmo
    #: critério de criar um cofre a partir de um backup.
    restore: bool = False
    #: Troca de tudo de uma vez (restaurar backup, carregar o exemplo, apagar tudo): o servidor
    #: guarda uma cópia do cofre com este motivo antes de gravar.
    checkpoint: Literal["before-restore", "before-sample", "before-reset"] | None = None
    upserts: dict[
        Literal["banks", "categories", "transactions", "investments", "reports"], list[dict]
    ] = Field(default_factory=dict)
    deletes: dict[
        Literal["banks", "categories", "transactions", "investments", "reports"], list[Id]
    ] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _unambiguous(self) -> Changes:
        """Um lote não pode dizer duas coisas sobre o mesmo registro.

        O navegador nunca manda isso (a fila junta tudo por registro), mas, se chegasse, o
        resultado dependeria da ordem de gravação: excluir e gravar o mesmo id, ou gravar duas
        versões dele, é recusado. Excluir o mesmo id duas vezes é inofensivo e vira uma vez só.
        """
        for collection, items in self.upserts.items():
            ids = [item.get("id") for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"{collection}: o mesmo registro aparece duas vezes")
            both = set(ids) & set(self.deletes.get(collection, []))
            if both:
                raise ValueError(f"{collection}: registro gravado e excluído no mesmo lote")
        self.deletes = {name: list(dict.fromkeys(ids)) for name, ids in self.deletes.items()}
        return self


class VaultSettings(_Model):
    language: Literal["pt", "en", "es"] = "pt"
    currency: Literal["BRL", "USD", "EUR"] = "BRL"
    theme: Literal["dark", "light", "system"] = "dark"
    hide_values: bool = False
    onboarding_done: bool = False
    #: Manda uma cópia por e-mail de cada arquivo exportado.
    email_copies: bool = False


class SettingsPatch(_Model):
    language: Literal["pt", "en", "es"] | None = None
    currency: Literal["BRL", "USD", "EUR"] | None = None
    theme: Literal["dark", "light", "system"] | None = None
    hide_values: bool | None = None
    onboarding_done: bool | None = None
    email_copies: bool | None = None
