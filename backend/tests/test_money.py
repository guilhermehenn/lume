from decimal import Decimal

import pytest

from app.domain.money import MoneyError, format_brl, parse_brl, split_installments, to_cents


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("10", 1000),
        ("10,5", 1050),
        ("10,50", 1050),
        ("R$ 1.234,56", 123456),
        ("1.234.567,89", 123456789),
        ("1.234", 123400),
        ("12.5", 1250),
        ("0,01", 1),
        (",99", 99),
        ("-25,00", -2500),
        ("R$ 7,00", 700),
    ],
)
def test_to_cents_aceita_formato_brasileiro(text, cents):
    assert to_cents(text) == cents


@pytest.mark.parametrize("text", ["", "abc", "1,2,3", "10,123", "1.2345", "12.34.5", "1.23,4"])
def test_to_cents_rejeita_texto_invalido(text):
    with pytest.raises(MoneyError):
        to_cents(text)


def test_to_cents_recusa_float_e_int():
    with pytest.raises(MoneyError):
        to_cents(0.1)
    with pytest.raises(MoneyError):
        to_cents(10)


def test_to_cents_com_decimal():
    assert to_cents(Decimal("0.10")) + to_cents(Decimal("0.20")) == 30
    with pytest.raises(MoneyError):
        to_cents(Decimal("1.005"))


def test_parse_brl_retorna_decimal_exato():
    assert parse_brl("0,1") + parse_brl("0,2") == Decimal("0.3")


@pytest.mark.parametrize(
    ("cents", "text"),
    [(0, "R$ 0,00"), (5, "R$ 0,05"), (123456, "R$ 1.234,56"), (-2500, "-R$ 25,00")],
)
def test_format_brl(cents, text):
    assert format_brl(cents) == text


def test_parcelas_somam_o_total_e_sobra_vai_na_ultima():
    assert split_installments(10000, 3) == [3333, 3333, 3334]
    assert split_installments(10000, 1) == [10000]
    for total in (1, 7, 999, 123457):
        for count in range(1, min(total, 24) + 1):
            parts = split_installments(total, count)
            assert sum(parts) == total
            assert len(parts) == count
            assert max(parts) - min(parts) < count


@pytest.mark.parametrize(("total", "count"), [(0, 1), (-100, 2), (100, 0), (2, 3), (100, 361)])
def test_parcelas_invalidas(total, count):
    with pytest.raises(MoneyError):
        split_installments(total, count)
