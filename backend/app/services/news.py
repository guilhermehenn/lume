"""Notícias de investimentos do dia (RSS de InfoMoney e Money Times).

Segurança: o XML vem de terceiros. Recusamos documentos com DTD/ENTITY, limitamos o tamanho,
só aceitamos links http(s) e todo o texto sai sem HTML.

Como no mercado: uma busca por vez e, sem internet, nova tentativa só depois de
RETRY_AFTER_FAILURE_SECONDS.
"""

from __future__ import annotations

import html
import logging
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlsplit

from app.services import remote

log = logging.getLogger(__name__)

FEEDS = (
    ("InfoMoney", "https://www.infomoney.com.br/mercados/feed/"),
    ("InfoMoney", "https://www.infomoney.com.br/onde-investir/feed/"),
    ("Money Times", "https://www.moneytimes.com.br/mercados/feed/"),
)
CACHE_TTL_SECONDS = 15 * 60
MIN_FORCED_REFRESH_SECONDS = 60
RETRY_AFTER_FAILURE_SECONDS = 120
#: Notícia com data mais de 10 min no futuro (fuso errado no feed) fica com a hora da busca.
FUTURE_TOLERANCE_SECONDS = 600
MAX_ITEMS = 8
MAX_TITLE = 200

_cache = remote.TimedCache("news", CACHE_TTL_SECONDS)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


def clean_text(value: str | None, limit: int = MAX_TITLE) -> str:
    if not value:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", value))
    text = _SPACE_RE.sub(" ", text).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def safe_link(value: str | None) -> str | None:
    if not value:
        return None
    link = value.strip()
    parts = urlsplit(link)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return link


def _parse_date(value: str | None, now: datetime | None = None) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value.strip())
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    now = now or datetime.now(UTC)
    if (parsed - now).total_seconds() > FUTURE_TOLERANCE_SECONDS:
        parsed = now
    return parsed.astimezone(UTC).isoformat(timespec="seconds")


def parse_rss(data: bytes, source: str, now: datetime | None = None) -> list[dict[str, Any]]:
    head = data[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in data.upper():
        raise ValueError("RSS com DTD/ENTITY recusado")
    root = ET.fromstring(data)  # noqa: S314 (DTD/ENTITY recusados acima; tamanho limitado)
    items: list[dict[str, Any]] = []
    for node in root.iter("item"):
        title = clean_text(node.findtext("title"))
        link = safe_link(node.findtext("link"))
        if not title or not link:
            continue
        items.append(
            {
                "title": title,
                "link": link,
                "source": source,
                "published_at": _parse_date(node.findtext("pubDate"), now),
            }
        )
    return items


def _fetch_feed(source: str, url: str) -> list[dict[str, Any]]:
    return parse_rss(remote.fetch_bytes(url), source)


def merge_items(groups: list[list[dict[str, Any]]], limit: int = MAX_ITEMS) -> list[dict[str, Any]]:
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for group in groups:
        for item in group:
            key = item["link"].split("?")[0].rstrip("/").lower()
            title_key = item["title"].lower()
            if key in seen or title_key in seen:
                continue
            seen.update({key, title_key})
            merged.append(item)
    merged.sort(key=lambda i: i.get("published_at") or "", reverse=True)
    return merged[:limit]


def _offline(cached: dict[str, Any] | None, errors: list[str]) -> dict[str, Any]:
    if cached is not None:
        return {**cached, "stale": True, "errors": errors}
    return {"updated_at": None, "stale": True, "items": [], "errors": errors}


def get_news(*, force: bool = False) -> dict[str, Any]:
    cached = _cache.get()
    if cached is not None and _cache.is_fresh() and not force:
        return cached
    with _cache.lock:
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

        groups: list[list[dict[str, Any]]] = []
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=len(FEEDS)) as pool:
            futures = [(source, pool.submit(_fetch_feed, source, url)) for source, url in FEEDS]
            for source, future in futures:
                try:
                    groups.append(future.result())
                except (remote.RemoteError, ValueError, ET.ParseError) as exc:
                    errors.append(f"{source}: {exc}")
        _cache.last_errors = errors
        if errors:
            log.info("Notícias com falhas: %s", "; ".join(errors))

        items = merge_items(groups)
        if not items:
            return _offline(cached, errors)
        result = {
            "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "stale": False,
            "items": items,
            "errors": errors,
        }
        _cache.set(result)
        return result


def reset_cache() -> None:
    _cache.clear()
