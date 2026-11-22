import json

import pytest

from app.services import market, remote

QUOTES = {
    "USDBRL": {"bid": "5.4321", "pctChange": "-0.35", "timestamp": "1795200000"},
    "EURBRL": {"bid": "6.1000", "pctChange": "0.10", "timestamp": "1795200000"},
    "BTCBRL": {"bid": "512345.67", "pctChange": "2.5", "timestamp": "1795200000"},
    "ETHBRL": {"bid": "18765.4", "pctChange": "-1.2", "timestamp": "1795200000"},
}
SELIC = [{"data": "19/11/2026", "valor": "14.25"}]
CDI = [{"data": "19/11/2026", "valor": "14.15"}]
IPCA = [{"data": f"01/{m:02d}/2026", "valor": "0.40"} for m in range(1, 12)] + [
    {"data": "01/10/2025", "valor": "0.50"}
]


@pytest.fixture(autouse=True)
def _fresh_cache():
    market.reset_cache()
    yield
    market.reset_cache()


def _fake_fetch(responses):
    def fetch(url):
        for key, value in responses.items():
            if key in url:
                if isinstance(value, Exception):
                    raise value
                return value
        raise remote.RemoteError(f"inesperado: {url}")

    return fetch


def test_parse_quotes():
    items = market.parse_quotes(QUOTES)
    assert [i["id"] for i in items] == ["USD", "EUR", "BTC", "ETH"]
    assert items[0]["value"] == pytest.approx(5.4321)
    assert items[0]["change_pct"] == pytest.approx(-0.35)
    assert items[0]["as_of"].startswith("2026-")


def test_parse_quotes_ignora_itens_quebrados():
    items = market.parse_quotes({"USDBRL": {"bid": "x"}, "EURBRL": QUOTES["EURBRL"]})
    assert [i["id"] for i in items] == ["EUR"]
    with pytest.raises(ValueError):
        market.parse_quotes({"OUTRO": {}})


def test_ipca_12_meses_compostos():
    rows = [{"data": f"01/{m:02d}/2026", "valor": "1.0"} for m in range(1, 13)]
    value, as_of = market.ipca_12_months(rows)
    assert value == pytest.approx(12.68, abs=0.01)
    assert as_of == "2026-12-01"
    with pytest.raises(ValueError):
        market.ipca_12_months(rows[:5])


def test_get_market_completo(monkeypatch):
    monkeypatch.setattr(
        remote,
        "fetch_json",
        _fake_fetch({"awesomeapi": QUOTES, "sgs.432": SELIC, "sgs.4389": CDI, "sgs.433": IPCA}),
    )
    result = market.get_market()
    assert result["stale"] is False
    assert [q["id"] for q in result["quotes"]] == ["USD", "EUR", "BTC", "ETH"]
    ids = [i["id"] for i in result["indicators"]]
    assert ids == ["SELIC", "CDI", "IPCA12M"]
    selic = result["indicators"][0]
    assert selic["value"] == pytest.approx(14.25)
    assert selic["as_of"] == "2026-11-19"


def test_falha_parcial_usa_ultimo_valor(monkeypatch):
    monkeypatch.setattr(
        remote,
        "fetch_json",
        _fake_fetch({"awesomeapi": QUOTES, "sgs.432": SELIC, "sgs.4389": CDI, "sgs.433": IPCA}),
    )
    market.get_market()
    monkeypatch.setattr(
        remote,
        "fetch_json",
        _fake_fetch(
            {
                "awesomeapi": remote.RemoteError("sem internet"),
                "sgs.432": SELIC,
                "sgs.4389": CDI,
                "sgs.433": IPCA,
            }
        ),
    )
    result = market.get_market(force=True)
    # Forçar dentro de 15 s devolve o cache sem buscar de novo.
    assert result["stale"] is False

    market._cache._stored_at -= 120  # simula cache vencido
    market._cache.last_attempt -= 120  # e a última tentativa também ficou para trás
    result = market.get_market()
    assert result["stale"] is True
    usd = next(q for q in result["quotes"] if q["id"] == "USD")
    assert usd["stale"] is True and usd["value"] == pytest.approx(5.4321)


def test_sem_internet_e_sem_cache(monkeypatch):
    monkeypatch.setattr(remote, "fetch_json", _fake_fetch({}))
    result = market.get_market()
    assert result["quotes"] == [] and result["indicators"] == []
    assert result["errors"]


def test_cache_em_disco_sobrevive_ao_reinicio(monkeypatch, isolated_settings):
    monkeypatch.setattr(
        remote,
        "fetch_json",
        _fake_fetch({"awesomeapi": QUOTES, "sgs.432": SELIC, "sgs.4389": CDI, "sgs.433": IPCA}),
    )
    market.get_market()
    saved = json.loads((isolated_settings / "cache" / "market.json").read_text(encoding="utf-8"))
    assert saved["value"]["quotes"][0]["id"] == "USD"

    market._cache = remote.TimedCache("market", market.CACHE_TTL_SECONDS)  # "reinício"
    monkeypatch.setattr(remote, "fetch_json", _fake_fetch({}))
    result = market.get_market()
    assert result["quotes"][0]["value"] == pytest.approx(5.4321)


def test_endereco_fora_da_lista_e_recusado():
    with pytest.raises(remote.RemoteError):
        remote.fetch_bytes("https://exemplo.com/qualquer")
    with pytest.raises(remote.RemoteError):
        remote.fetch_bytes("http://economia.awesomeapi.com.br/json/last/USD-BRL")
