"""Cotações (AwesomeAPI) e indicadores (Banco Central / SGS) para a tela inicial.

Fontes:
- https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL,ETH-BRL
- https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/{n}?formato=json
  432 = meta Selic · 4389 = CDI anualizado (base 252) · 433 = IPCA mensal

Falhas parciais não derrubam a resposta: o que não vier agora é completado com o último
valor conhecido e marcado como desatualizado ("stale").

Uma busca por vez: várias abas (ou o botão Atualizar apertado várias vezes) esperam a mesma
resposta. Sem internet, a próxima tentativa só acontece depois de RETRY_AFTER_FAILURE_SECONDS;
até lá, o último dado conhecido volta na hora, sem esperar o limite de tempo da rede.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from app.services import remote

log = logging.getLogger(__name__)

QUOTES_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL,ETH-BRL"
SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados/ultimos/{n}?formato=json"

QUOTES = (
    ("USD", "USDBRL"),
    ("EUR", "EURBRL"),
    ("BTC", "BTCBRL"),
    ("ETH", "ETHBRL"),
)
SERIES = {"selic": 432, "cdi": 4389, "ipca": 433}

CACHE_TTL_SECONDS = 60
MIN_FORCED_REFRESH_SECONDS = 15
RETRY_AFTER_FAILURE_SECONDS = 30
SOURCES = ["AwesomeAPI", "Banco Central do Brasil (SGS)"]

_cache = remote.TimedCache("market", CACHE_TTL_SECONDS)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def parse_quotes(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("resposta de cotações inesperada")
    items: list[dict[str, Any]] = []
    for code, key in QUOTES:
        raw = payload.get(key)
        if not isinstance(raw, dict):
            continue
        try:
            value = remote.finite(raw["bid"])
            change = remote.finite(raw.get("pctChange") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if value <= 0:
            continue
        as_of = None
        timestamp = raw.get("timestamp")
        if timestamp is not None:
            try:
                as_of = datetime.fromtimestamp(int(timestamp), UTC).isoformat(timespec="seconds")
            except (TypeError, ValueError, OverflowError):
                as_of = None
        items.append(
            {"id": code, "value": value, "change_pct": change, "currency": "BRL", "as_of": as_of}
        )
    if not items:
        raise ValueError("nenhuma cotação reconhecida")
    return items


def _sgs_date(text: str) -> str:
    day, month, year = text.split("/")
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def parse_sgs_last(rows: Any) -> tuple[float, str]:
    if not isinstance(rows, list) or not rows:
        raise ValueError("série vazia")
    last = rows[-1]
    return remote.finite(last["valor"]), _sgs_date(last["data"])


def ipca_12_months(rows: Any) -> tuple[float, str]:
    """IPCA acumulado em 12 meses a partir das 12 variações mensais."""
    if not isinstance(rows, list) or len(rows) < 12:
        raise ValueError("são necessários 12 meses de IPCA")
    factor = 1.0
    for row in rows[-12:]:
        factor *= 1 + remote.finite(row["valor"]) / 100
    return round((factor - 1) * 100, 2), _sgs_date(rows[-1]["data"])


def _fetch_indicator(name: str) -> dict[str, Any]:
    code = SERIES[name]
    if name == "ipca":
        rows = remote.fetch_json(SGS_URL.format(code=code, n=12))
        value, as_of = ipca_12_months(rows)
        return {"id": "IPCA12M", "value": value, "unit": "%", "as_of": as_of}
    rows = remote.fetch_json(SGS_URL.format(code=code, n=1))
    value, as_of = parse_sgs_last(rows)
    return {"id": name.upper(), "value": value, "unit": "% a.a.", "as_of": as_of}


def _collect() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    errors: list[str] = []
    quotes: list[dict[str, Any]] = []
    indicators: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        quotes_future = pool.submit(remote.fetch_json, QUOTES_URL)
        indicator_futures = {name: pool.submit(_fetch_indicator, name) for name in SERIES}
        try:
            quotes = parse_quotes(quotes_future.result())
        except (remote.RemoteError, ValueError) as exc:
            errors.append(f"cotações: {exc}")
        for name, future in indicator_futures.items():
            try:
                indicators.append(future.result())
            except (remote.RemoteError, ValueError, KeyError, TypeError) as exc:
                errors.append(f"{name}: {exc}")
    return quotes, indicators, errors


def _merge(fresh: list[dict[str, Any]], previous: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {item["id"]: {**item, "stale": False} for item in fresh}
    for item in previous:
        if item["id"] not in by_id:
            by_id[item["id"]] = {**item, "stale": True}
    order = [code for code, _ in QUOTES] + ["SELIC", "CDI", "IPCA12M"]
    return sorted(by_id.values(), key=lambda i: order.index(i["id"]) if i["id"] in order else 99)


def _offline(cached: dict[str, Any] | None, errors: list[str]) -> dict[str, Any]:
    """Sem dado novo: o último conhecido (marcado como desatualizado) ou listas vazias."""
    if cached is not None:
        return {
            **cached,
            "stale": True,
            "quotes": [{**q, "stale": True} for q in cached.get("quotes", [])],
            "indicators": [{**i, "stale": True} for i in cached.get("indicators", [])],
            "errors": errors,
        }
    return {
        "updated_at": None,
        "stale": True,
        "quotes": [],
        "indicators": [],
        "sources": SOURCES,
        "errors": errors,
    }


def get_market(*, force: bool = False) -> dict[str, Any]:
    cached = _cache.get()
    if cached is not None and _cache.is_fresh() and not force:
        return cached
    with _cache.lock:
        # Quem esperou a busca de outra requisição já recebe o resultado dela.
        cached = _cache.get()
        if cached is not None and _cache.is_fresh() and not force:
            return cached
        wait = MIN_FORCED_REFRESH_SECONDS if force else RETRY_AFTER_FAILURE_SECONDS
        if _cache.since_attempt() < wait:
            return (
                cached
                if cached is not None and _cache.is_fresh()
                else _offline(cached, _cache.last_errors)
            )
        _cache.mark_attempt()
        quotes, indicators, errors = _collect()
        _cache.last_errors = errors
        if errors:
            log.info("Mercado com falhas parciais: %s", "; ".join(errors))
        if not quotes and not indicators:
            return _offline(cached, errors)

        previous = cached or {"quotes": [], "indicators": []}
        result = {
            "updated_at": _now_iso(),
            "stale": bool(errors),
            "quotes": _merge(quotes, previous.get("quotes", [])),
            "indicators": _merge(indicators, previous.get("indicators", [])),
            "sources": SOURCES,
            "errors": errors,
        }
        _cache.set(result)
        return result


def reset_cache() -> None:
    _cache.clear()
