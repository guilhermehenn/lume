"""Cotações, indicadores e notícias para a tela inicial."""

from __future__ import annotations

from fastapi import APIRouter

from app.services import market, news

router = APIRouter(tags=["mercado"])


@router.get("/market")
def get_market(refresh: bool = False):
    return market.get_market(force=refresh)


@router.get("/news")
def get_news(refresh: bool = False):
    return news.get_news(force=refresh)
