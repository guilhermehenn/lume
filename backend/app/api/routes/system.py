"""Saúde e informações do sistema."""

from __future__ import annotations

import platform
import sqlite3

from fastapi import APIRouter

from app import __version__
from app.core import paths
from app.core.config import SERVICE_ID, get_settings
from app.data import migrate
from app.data.db import get_engine
from app.services import backup

router = APIRouter(tags=["sistema"])


@router.get("/health")
def health():
    settings = get_settings()
    return {
        "status": "ok",
        "service": SERVICE_ID,
        "app": settings.display_name,
        "version": __version__,
    }


@router.get("/system/info")
def system_info():
    settings = get_settings()
    db_path = paths.db_file()
    with get_engine().connect() as connection:
        journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar()
        foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
    backups = backup.list_backups()
    return {
        "app": settings.display_name,
        "version": __version__,
        "python": platform.python_version(),
        "sqlite": sqlite3.sqlite_version,
        "os": f"{platform.system()} {platform.release()}",
        "data_dir": str(settings.data_dir),
        "database": {
            "path": str(db_path),
            "size_bytes": db_path.stat().st_size if db_path.exists() else 0,
            "journal_mode": journal_mode,
            "foreign_keys": bool(foreign_keys),
            "schema_revision": migrate.current_revision(),
            "schema_head": migrate.head_revision(),
        },
        "backups": {
            "count": len(backups),
            "latest": backups[0].as_dict() if backups else None,
            "folder": str(paths.backups_dir()),
            "extra_folder": str(settings.backup_extra_dir) if settings.backup_extra_dir else None,
            "keep_daily": settings.backup_keep_daily,
            "keep_weekly": settings.backup_keep_weekly,
        },
    }
