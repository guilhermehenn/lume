"""Aplicação FastAPI.

Serve a API em /api e, na raiz (/), o front-end compilado (frontend/dist).
Enquanto o front não existe, serve uma página provisória de status (app/web).
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.routes import backups, market, system, vaults
from app.api.security import DEFAULT_ALLOWED_HOSTS, LocalSecurityMiddleware
from app.bootstrap import prepare
from app.core import paths
from app.core.config import APP_DIR, get_settings
from app.core.log_setup import setup_logging

PLACEHOLDER_DIR = APP_DIR / "web"


def static_dir() -> Path:
    dist = get_settings().project_root / "frontend" / "dist"
    return dist if (dist / "index.html").is_file() else PLACEHOLDER_DIR


def create_app(*, extra_allowed_hosts: tuple[str, ...] = ()) -> FastAPI:
    settings = get_settings()
    paths.ensure_dirs()
    setup_logging(settings.log_level, paths.logs_dir())

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        prepare(run_backup=False)  # idempotente: o launcher já fez backup e migrations
        yield

    app = FastAPI(
        title=settings.display_name,
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(
        LocalSecurityMiddleware,
        allowed_hosts=DEFAULT_ALLOWED_HOSTS + tuple(extra_allowed_hosts),
    )
    app.include_router(system.router, prefix="/api")
    app.include_router(backups.router, prefix="/api")
    app.include_router(market.router, prefix="/api")
    app.include_router(vaults.router, prefix="/api")

    @app.exception_handler(sqlite3.OperationalError)
    async def storage_error(_request: Request, exc: sqlite3.OperationalError) -> JSONResponse:
        # Disco cheio, arquivo travado por outro programa (antivírus, sincronizador)...
        logging.getLogger("app.vaults").error("Erro de armazenamento: %s", exc)
        return JSONResponse(
            {
                "detail": {
                    "code": "storage",
                    "message": "Não foi possível gravar no disco agora. Tente de novo.",
                }
            },
            status_code=503,
        )

    app.mount("/", StaticFiles(directory=static_dir(), html=True), name="web")
    return app
