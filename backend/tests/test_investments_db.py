"""Investimentos: regras de cada operação, CNPJ (também alfanumérico) e precisão das quantidades."""

import sqlite3
import time

import pytest
from test_vaults import NOW, bank, inv, new_vault, state

from app.vaults import models, registry, service


def _changes(base, upserts=None, deletes=None):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}}


def _fails(session, item) -> str:
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(1, {"investments": [item]}))
    assert err.value.code == "invalid"
    return str(err.value)


# ---------------------------------------------------------------- CNPJ


@pytest.mark.parametrize(
    "cnpj",
    [
        "30.680.829/0001-43",
        "11.222.333/0001-81",
        "11222333000181",
        "12.ABC.345/01DE-35",  # alfanumérico, exemplo da Receita Federal
        "12abc34501de35",
    ],
)
def test_cnpj_valido(cnpj):
    assert models.valid_cnpj(cnpj)


@pytest.mark.parametrize(
    "cnpj",
    [
        "11.222.333/0001-82",
        "00.000.000/0000-00",
        "12.ABC.345/01DE-36",
        "12.ABC.345/01DE-3A",  # dígito verificador continua numérico
        "12.AB#.345/01DE-35",
        "123",
        "",
    ],
)
def test_cnpj_invalido(cnpj):
    assert not models.valid_cnpj(cnpj)


# ---------------------------------------------------------------- regras de cada operação


def test_operacao_valida_passa():
    session = new_vault(data=state(investments=[]))
    service.apply_changes(
        session,
        _changes(
            1,
            {
                "investments": [
                    inv("a"),
                    inv(
                        "b",
                        operation="earning",
                        type="fii",
                        asset="HGLG11",
                        quantity=None,
                        unitPrice=None,
                        fees=None,
                        earningKind="fii_income",
                        taxWithheld=100,
                        amount=1000,
                        issuerCnpj="12.ABC.345/01DE-35",
                    ),
                    inv(
                        "c",
                        type="cdb",
                        asset="CDB Banco X",
                        quantity=None,
                        unitPrice=None,
                        fees=None,
                    ),
                ]
            },
        ),
    )


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        ({"quantity": None}, "quantidade obrigatória"),
        ({"operation": "earning", "earningKind": "dividend"}, "rendimento não tem quantidade"),
        ({"earningKind": "dividend"}, "só valem para rendimentos"),
        ({"taxWithheld": 10}, "só valem para rendimentos"),
        ({"fees": 999_999}, "taxas maiores"),
        ({"type": "treasury", "asset": "Tesouro IPCA+ 2035"}, "título do Tesouro"),
        ({"issuerCnpj": "11.222.333/0001-82"}, "CNPJ inválido"),
        ({"asset": "   "}, "asset"),
    ],
)
def test_operacao_inconsistente_e_recusada(extra, message):
    session = new_vault(data=state(investments=[]))
    text = _fails(session, inv("x", **extra))
    assert message in text
    with sqlite3.connect(registry.path_for(session.vault_id)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM investments").fetchone() == (0,)


def test_ir_retido_maior_que_o_rendimento_e_recusado():
    session = new_vault(data=state(investments=[]))
    earning = inv(
        "e",
        operation="earning",
        quantity=None,
        unitPrice=None,
        fees=None,
        amount=1000,
        taxWithheld=1001,
    )
    assert "IR retido maior" in _fails(session, earning)


def test_cofre_antigo_importado_nao_e_barrado_pelas_regras_novas():
    """Dados de versões anteriores entram; as regras valem para gravações novas."""
    legacy = inv("velho", quantity=None, earningKind="dividend")
    session = new_vault(data=state(investments=[legacy]))
    loaded = service.load_data(session)["data"]["investments"]
    assert [i["id"] for i in loaded] == ["velho"]


def test_espacos_no_nome_do_ativo_saem():
    session = new_vault(data=state(investments=[]))
    service.apply_changes(session, _changes(1, {"investments": [inv("a", asset="  PETR4  ")]}))
    assert service.load_data(session)["data"]["investments"][0]["asset"] == "PETR4"


# ---------------------------------------------------------------- precisão e volume


@pytest.mark.parametrize("quantity", [0.00000001, 0.1, 0.3, 123456.12345678, 999_999_999.5])
def test_quantidade_volta_exatamente_como_foi(quantity):
    session = new_vault(
        data=state(investments=[inv("q", type="crypto", asset="BTC", quantity=quantity)])
    )
    assert service.load_data(session)["data"]["investments"][0]["quantity"] == quantity


def test_banco_com_investimentos_nao_pode_sair():
    session = new_vault(data=state(banks=[bank("b1"), bank("b2", name="XP", isPrimary=False)]))
    with pytest.raises(service.ServiceError, match="banco excluído ainda tem"):
        service.apply_changes(session, _changes(1, deletes={"banks": ["b1"]}))


def test_20_mil_operacoes_gravam_e_abrem_rapido():
    ops = [inv(f"i{i}", asset=f"ATV{i % 500}", createdAt=NOW) for i in range(20_000)]
    session = new_vault(data=state(investments=[]))
    started = time.perf_counter()
    service.apply_changes(session, _changes(1, {"investments": ops}))
    saved = time.perf_counter() - started
    started = time.perf_counter()
    loaded = service.load_data(session)["data"]["investments"]
    opened = time.perf_counter() - started
    print(f"\n  20 mil operações: gravar {saved * 1000:.0f} ms, abrir {opened * 1000:.0f} ms")
    assert len(loaded) == 20_000
    assert saved < 5 and opened < 1
