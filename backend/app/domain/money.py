"""Dinheiro em centavos inteiros. Nunca float.

- ``to_cents``: texto em pt-BR ("1.234,56", "R$ 10,50") ou Decimal -> centavos (int)
- ``format_brl``: centavos -> "R$ 1.234,56"
- ``split_installments``: divide um valor em parcelas que somam exatamente o total
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

MAX_INSTALLMENTS = 360

_GROUPED_THOUSANDS = re.compile(r"^\d{1,3}(\.\d{3})+$")
_DIGITS = re.compile(r"^\d+$")


class MoneyError(ValueError):
    """Valor monetário inválido."""


def parse_brl(text: str) -> Decimal:
    """Converte texto em Decimal, aceitando o formato brasileiro.

    Regras:
    - vírgula é o separador decimal ("10,5" = 10,50);
    - ponto com 1 ou 2 dígitos depois é decimal ("10.5" = 10,50);
    - ponto com grupos de 3 dígitos é separador de milhar ("1.234" = 1234,00);
    - mais de 2 casas decimais é erro (não arredondamos dinheiro escondido).
    """
    if not isinstance(text, str):
        raise MoneyError("Valor precisa ser texto.")
    s = text.strip().replace("R$", "").replace(" ", "").replace(" ", "")
    negative = s.startswith("-")
    if negative:
        s = s[1:]
    if not s:
        raise MoneyError("Valor vazio.")

    if "," in s:
        if s.count(",") > 1:
            raise MoneyError(f"Valor inválido: {text!r}.")
        int_part, frac = s.split(",")
        if "." in int_part:
            if not _GROUPED_THOUSANDS.match(int_part):
                raise MoneyError(f"Separador de milhar inválido: {text!r}.")
            int_part = int_part.replace(".", "")
    elif "." in s:
        parts = s.split(".")
        if len(parts) == 2 and 1 <= len(parts[1]) <= 2:
            int_part, frac = parts
        elif _GROUPED_THOUSANDS.match(s):
            int_part, frac = s.replace(".", ""), ""
        else:
            raise MoneyError(f"Valor inválido: {text!r}.")
    else:
        int_part, frac = s, ""

    int_part = int_part or "0"
    if not _DIGITS.match(int_part) or (frac and not _DIGITS.match(frac)):
        raise MoneyError(f"Valor inválido: {text!r}.")
    if len(frac) > 2:
        raise MoneyError(f"Use no máximo 2 casas decimais: {text!r}.")

    value = Decimal(f"{int_part}.{frac or '0'}")
    return -value if negative else value


def to_cents(value: str | Decimal) -> int:
    if isinstance(value, bool | int | float):
        raise MoneyError(
            "Use texto ou Decimal. float é impreciso e int é ambíguo (reais ou centavos?)."
        )
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise MoneyError("Valor precisa ser finito.")
        amount = value
    else:
        amount = parse_brl(value)
    try:
        if amount != amount.quantize(Decimal("0.01")):
            raise MoneyError(f"Use no máximo 2 casas decimais: {value}.")
    except InvalidOperation as exc:
        raise MoneyError(f"Valor inválido: {value}.") from exc
    return int(amount * 100)


def format_brl(cents: int) -> str:
    if isinstance(cents, bool) or not isinstance(cents, int):
        raise MoneyError("Centavos precisam ser um número inteiro.")
    sign = "-" if cents < 0 else ""
    reais, centavos = divmod(abs(cents), 100)
    grouped = f"{reais:,}".replace(",", ".")
    return f"{sign}R$ {grouped},{centavos:02d}"


def split_installments(total_cents: int, count: int) -> list[int]:
    """Divide ``total_cents`` em ``count`` parcelas. A diferença de centavos vai na última.

    Exemplo: R$ 100,00 em 3x -> [3333, 3333, 3334].
    """
    if isinstance(total_cents, bool) or not isinstance(total_cents, int) or total_cents <= 0:
        raise MoneyError("O total precisa ser um inteiro positivo em centavos.")
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_INSTALLMENTS:
        raise MoneyError(f"Número de parcelas precisa estar entre 1 e {MAX_INSTALLMENTS}.")
    if total_cents < count:
        raise MoneyError("Cada parcela precisa ter pelo menos 1 centavo.")
    base, remainder = divmod(total_cents, count)
    return [base] * (count - 1) + [base + remainder]
