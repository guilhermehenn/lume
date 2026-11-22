"""Tela Início: cotações, notícias e a leitura do cofre que alimenta saldos e resumo do mês."""

import json
import threading
import time
from datetime import UTC, datetime

import pytest
from test_vaults import bank, inv, new_vault, state, tx

from app.services import market, news, remote
from app.vaults import service, store

QUOTES = {
    "USDBRL": {"bid": "5.4321", "pctChange": "-0.35", "timestamp": "1795200000"},
    "EURBRL": {"bid": "6.1000", "pctChange": "0.10", "timestamp": "1795200000"},
}
SELIC = [{"data": "19/11/2026", "valor": "14.25"}]
CDI = [{"data": "19/11/2026", "valor": "14.15"}]
IPCA = [{"data": f"01/{m:02d}/2026", "valor": "0.40"} for m in range(1, 13)]
RSS = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Notícia certa</title><link>https://www.infomoney.com.br/a/</link>
<pubDate>Fri, 20 Nov 2026 13:05:00 -0300</pubDate></item>
<item><title>Notícia do futuro</title><link>https://www.infomoney.com.br/b/</link>
<pubDate>Fri, 20 Nov 2026 23:59:00 -0300</pubDate></item>
</channel></rss>""".encode()


@pytest.fixture(autouse=True)
def _fresh_caches():
    market.reset_cache()
    news.reset_cache()
    yield
    market.reset_cache()
    news.reset_cache()


class Clock:
    def __init__(self, now: float = 1_000_000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(market._cache, "clock", fake)
    monkeypatch.setattr(news._cache, "clock", fake)
    return fake


def online(calls: list[str] | None = None, delay: float = 0.0, quotes=QUOTES):
    responses = {"awesomeapi": quotes, "sgs.432": SELIC, "sgs.4389": CDI, "sgs.433": IPCA}

    def fetch(url):
        if calls is not None:
            calls.append(url)
        if delay:
            time.sleep(delay)
        for key, value in responses.items():
            if key in url:
                return value
        raise remote.RemoteError(url)

    return fetch


def offline(calls: list[str]):
    def fetch(url, **_kwargs):
        calls.append(url)
        raise remote.RemoteError("sem internet")

    return fetch


# ---------------------------------------------------------------- mercado


def test_varias_abas_ao_mesmo_tempo_fazem_uma_busca_so(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(remote, "fetch_json", online(calls, delay=0.2))
    results: list[dict] = []
    threads = [
        threading.Thread(target=lambda: results.append(market.get_market())) for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 8
    assert sum("awesomeapi" in url for url in calls) == 1
    assert all(r["quotes"][0]["value"] == pytest.approx(5.4321) for r in results)


def test_sem_internet_nao_insiste_a_cada_pedido(monkeypatch, clock):
    monkeypatch.setattr(remote, "fetch_json", online())
    market.get_market()
    clock.now += market.CACHE_TTL_SECONDS + 1  # venceu

    calls: list[str] = []
    monkeypatch.setattr(remote, "fetch_json", offline(calls))
    first = market.get_market()
    tried = len(calls)
    assert tried > 0 and first["stale"] is True
    assert all(q["stale"] for q in first["quotes"])

    # Pedidos seguidos (outras abas, o minuto seguinte) voltam na hora com o último dado.
    for _ in range(5):
        again = market.get_market()
        assert again["quotes"][0]["value"] == pytest.approx(5.4321)
    assert len(calls) == tried

    clock.now += market.RETRY_AFTER_FAILURE_SECONDS
    market.get_market()
    assert len(calls) == tried * 2


def test_sem_internet_e_sem_cache_responde_rapido_da_segunda_vez(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(remote, "fetch_json", offline(calls))
    first = market.get_market()
    second = market.get_market()
    assert first["quotes"] == second["quotes"] == []
    assert second["errors"] and second["stale"] is True
    assert len(calls) == 4  # 1 de cotações + 3 indicadores, só na primeira


def test_atualizar_a_toda_hora_respeita_o_intervalo_minimo(monkeypatch, clock):
    calls: list[str] = []
    monkeypatch.setattr(remote, "fetch_json", online(calls))
    market.get_market()
    for _ in range(5):
        market.get_market(force=True)
    assert len(calls) == 4
    clock.now += market.MIN_FORCED_REFRESH_SECONDS
    market.get_market(force=True)
    assert len(calls) == 8


@pytest.mark.parametrize("bad", ["NaN", "nan", "inf", "-Infinity", "1e999", "0", "-5"])
def test_cotacao_invalida_e_ignorada_e_a_resposta_continua_json_valido(monkeypatch, bad):
    quotes = {**QUOTES, "USDBRL": {**QUOTES["USDBRL"], "bid": bad}}
    monkeypatch.setattr(remote, "fetch_json", online(quotes=quotes))
    result = market.get_market()
    assert [q["id"] for q in result["quotes"]] == ["EUR"]
    json.dumps(result, allow_nan=False)


def test_indicador_com_nan_vira_falha_parcial(monkeypatch):
    def fetch(url):
        if "sgs.432" in url:
            return [{"data": "19/11/2026", "valor": "NaN"}]
        return online()(url)

    monkeypatch.setattr(remote, "fetch_json", fetch)
    result = market.get_market()
    assert "SELIC" not in [i["id"] for i in result["indicators"]]
    assert any(e.startswith("selic") for e in result["errors"])
    json.dumps(result, allow_nan=False)


def test_cache_gravado_no_futuro_vence(monkeypatch, clock, isolated_settings):
    monkeypatch.setattr(remote, "fetch_json", online())
    market.get_market()
    path = isolated_settings / "cache" / "market.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    saved["stored_at"] = clock.now + 30 * 86400  # relógio do computador voltou um mês
    path.write_text(json.dumps(saved), encoding="utf-8")

    fresh = remote.TimedCache("market", market.CACHE_TTL_SECONDS, clock=clock)
    assert fresh.get() is not None
    assert fresh.is_fresh() is False


@pytest.mark.parametrize(
    "content",
    ["", "{", "[]", '{"value": [], "stored_at": 1}', '{"value": {}, "stored_at": "NaN"}'],
)
def test_cache_em_disco_estragado_e_ignorado(isolated_settings, content):
    path = isolated_settings / "cache" / "market.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    cache = remote.TimedCache("market", 60)
    assert cache.get() is None
    assert cache.is_fresh() is False


def test_gravacao_do_cache_nao_deixa_temporarios(monkeypatch, isolated_settings):
    monkeypatch.setattr(remote, "fetch_json", online())
    market.get_market()
    files = sorted(p.name for p in (isolated_settings / "cache").iterdir())
    assert files == ["market.json"]


def test_endpoint_sem_internet_responde_json_valido(monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from app.main import create_app

    calls: list[str] = []
    monkeypatch.setattr(remote, "fetch_json", offline(calls))
    monkeypatch.setattr(remote, "fetch_bytes", offline(calls))
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        body = client.get("/api/market").json()
        assert body["quotes"] == [] and body["indicators"] == [] and body["stale"] is True
        started = time.perf_counter()
        assert client.get("/api/market").status_code == 200
        assert client.get("/api/news").json()["items"] == []
        assert time.perf_counter() - started < 2


# ---------------------------------------------------------------- notícias


def test_noticia_com_data_no_futuro_fica_com_a_hora_da_busca():
    now = datetime(2026, 11, 20, 17, 0, tzinfo=UTC)  # 14:00 em Brasília
    items = {i["title"]: i for i in news.parse_rss(RSS, "InfoMoney", now=now)}
    assert items["Notícia certa"]["published_at"] == "2026-11-20T16:05:00+00:00"
    assert items["Notícia do futuro"]["published_at"] == now.isoformat(timespec="seconds")


def test_noticias_varias_abas_uma_busca_e_sem_internet_espera(monkeypatch, clock):
    calls: list[str] = []

    def fetch(url, **_kwargs):
        calls.append(url)
        time.sleep(0.1)
        return RSS

    monkeypatch.setattr(remote, "fetch_bytes", fetch)
    threads = [threading.Thread(target=news.get_news) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == len(news.FEEDS)

    clock.now += news.CACHE_TTL_SECONDS + 1
    failed: list[str] = []
    monkeypatch.setattr(remote, "fetch_bytes", offline(failed))
    assert news.get_news()["stale"] is True
    assert news.get_news()["items"]
    assert len(failed) == len(news.FEEDS)


# ---------------------------------------------------------------- leitura do cofre


def test_leitura_e_um_retrato_de_um_instante_so():
    """Uma gravação no meio da leitura não aparece pela metade."""
    session = new_vault(data=state())
    original = store.read_state

    # Gravação real pela API do serviço, disparada no meio da leitura.
    def read_with_service_write(conn):
        service.apply_changes(
            session,
            {
                "baseRevision": 1,
                "upserts": {
                    "banks": [bank("b2", name="Itaú")],
                    "transactions": [tx("t2", bankId="b2")],
                },
            },
        )
        return original(conn)

    store.read_state = read_with_service_write
    try:
        payload = service.load_data(session)
    finally:
        store.read_state = original
    data = payload["data"]
    assert payload["revision"] == 1
    assert {b["id"] for b in data["banks"]} == {"b1"}
    assert {t["id"] for t in data["transactions"]} == {"t1"}
    # E a próxima leitura vê tudo junto, com a revisão nova.
    after = service.load_data(session)
    assert after["revision"] == 2
    assert {t["bankId"] for t in after["data"]["transactions"]} <= {
        b["id"] for b in after["data"]["banks"]
    }


def test_leitura_mantem_tipos_e_omite_vazios():
    report = {
        "id": "r1",
        "name": "Mercado",
        "groupBy": "month",
        "createdAt": "2026-01-01T00:00:00Z",
        "filters": {"kinds": ["expense"], "categoryIds": ["c1"], "bankIds": []},
    }
    data = state(
        banks=[bank(isPrimary=True)],
        investments=[inv(type="cdb", asset="CDB Nu", dailyLiquidity=True, quantity=None)],
        reports=[report],
    )
    data["investments"][0].pop("quantity")
    data["investments"][0].pop("unitPrice")
    data["investments"][0].pop("fees")
    session = new_vault(data=data)
    loaded = service.load_data(session)["data"]
    assert loaded["banks"][0]["isPrimary"] is True
    assert loaded["investments"][0]["dailyLiquidity"] is True
    assert "quantity" not in loaded["investments"][0]
    assert "note" not in loaded["transactions"][0]
    assert loaded["reports"][0]["filters"]["kinds"] == ["expense"]


def test_abrir_cofre_com_100_mil_lancamentos():
    session = new_vault(data=state(transactions=[tx(f"t{i}") for i in range(100_000)]))
    best = float("inf")
    for _ in range(3):
        started = time.perf_counter()
        payload = service.load_data(session)
        best = min(best, time.perf_counter() - started)
    assert len(payload["data"]["transactions"]) == 100_000
    print(f"\n  abrir cofre com 100 mil lançamentos: {best * 1000:.0f} ms")
    assert best < 1.5
