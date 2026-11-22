"""Caminhos de dados do app, iguais em Windows e macOS (via platformdirs).

Windows: %LOCALAPPDATA%\\<APP_NAME>\\
macOS:   ~/Library/Application Support/<APP_NAME>/
"""

from __future__ import annotations

import os
from pathlib import Path

from app.core.config import get_settings

DB_FILENAME = "lume.db"


def data_dir() -> Path:
    return get_settings().data_dir


def db_file() -> Path:
    return data_dir() / DB_FILENAME


def backups_dir() -> Path:
    return data_dir() / "backups"


def logs_dir() -> Path:
    return data_dir() / "logs"


def ensure_dirs() -> None:
    """Cria as pastas de dados. No macOS, só o próprio usuário pode lê-las (700)."""
    for folder in (data_dir(), backups_dir(), logs_dir()):
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "posix":
            folder.chmod(0o700)


def secure_file(path: Path) -> None:
    """No macOS, deixa o banco (e os arquivos -wal/-shm) legível só pelo usuário (600)."""
    if os.name != "posix":
        return
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if candidate.exists():
            candidate.chmod(0o600)
