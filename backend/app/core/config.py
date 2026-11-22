"""Configuração do app.

Ordem de prioridade (a última vence):
1. valores padrão deste arquivo;
2. arquivo .env na raiz do projeto;
3. variáveis de ambiente do sistema com os mesmos nomes.

Só as chaves listadas em ``KNOWN_KEYS`` são lidas. O host é fixo em 127.0.0.1
de propósito: o servidor nunca fica exposto na rede.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from platformdirs import user_data_dir

APP_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = APP_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent

HOST = "127.0.0.1"
SERVICE_ID = "lume"

KNOWN_KEYS = (
    "APP_NAME",
    "APP_DISPLAY_NAME",
    "APP_PORT",
    "APP_DATA_DIR",
    "APP_BACKUP_EXTRA_DIR",
    "APP_BACKUP_KEEP_DAILY",
    "APP_BACKUP_KEEP_WEEKLY",
    "APP_OPEN_BROWSER",
    "APP_LOG_LEVEL",
)

DEFAULTS = {
    "APP_NAME": "Lume",
    "APP_DISPLAY_NAME": "Lume",
    "APP_PORT": "8765",
    "APP_DATA_DIR": "",
    "APP_BACKUP_EXTRA_DIR": "",
    "APP_BACKUP_KEEP_DAILY": "7",
    "APP_BACKUP_KEEP_WEEKLY": "4",
    "APP_OPEN_BROWSER": "true",
    "APP_LOG_LEVEL": "INFO",
}

# Trechos de caminho típicos de pastas sincronizadas com a nuvem.
# O banco em uso nunca pode ficar nelas: a sincronização pode corromper o SQLite.
CLOUD_SYNC_MARKERS = (
    "onedrive",
    "icloud",
    "mobile documents",
    "clouddocs",
    "cloudstorage",
    "dropbox",
    "google drive",
    "googledrive",
    "box sync",
)

_APP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$")
_LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR"}


class ConfigError(Exception):
    """Configuração inválida. A mensagem é mostrada ao usuário."""


@dataclass(frozen=True)
class Settings:
    app_name: str
    display_name: str
    port: int
    data_dir: Path
    backup_extra_dir: Path | None
    backup_keep_daily: int
    backup_keep_weekly: int
    open_browser: bool
    log_level: str
    project_root: Path


def read_env_file(path: Path) -> dict[str, str]:
    """Lê um arquivo .env simples (CHAVE=valor). Ignora comentários e linhas vazias."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key in KNOWN_KEYS:
            values[key] = value
    return values


def is_cloud_synced(path: Path) -> bool:
    text = str(path).replace("\\", "/").lower()
    return any(marker in text for marker in CLOUD_SYNC_MARKERS)


def _expand_path(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(value))).resolve()


def _to_int(raw: str, key: str, minimum: int, maximum: int) -> int:
    try:
        number = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{key} precisa ser um número inteiro (recebido: {raw!r}).") from exc
    if not minimum <= number <= maximum:
        raise ConfigError(f"{key} precisa estar entre {minimum} e {maximum} (recebido: {number}).")
    return number


def _to_bool(raw: str, key: str) -> bool:
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "sim", "yes", "on"):
        return True
    if lowered in ("0", "false", "nao", "não", "no", "off"):
        return False
    raise ConfigError(f"{key} precisa ser true ou false (recebido: {raw!r}).")


def load_settings(environ: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ if environ is None else environ)
    values = dict(DEFAULTS)
    if env.get("APP_IGNORE_DOTENV") != "1":
        values.update(read_env_file(PROJECT_ROOT / ".env"))
    values.update({k: v for k, v in env.items() if k in KNOWN_KEYS})

    app_name = values["APP_NAME"].strip()
    if not _APP_NAME_RE.match(app_name):
        raise ConfigError(
            "APP_NAME aceita até 60 caracteres: letras sem acento, números, espaço, ponto, "
            f"hífen ou sublinhado (recebido: {app_name!r})."
        )

    data_dir = (
        _expand_path(values["APP_DATA_DIR"])
        if values["APP_DATA_DIR"].strip()
        else Path(user_data_dir(app_name, appauthor=False, roaming=False))
    )
    if is_cloud_synced(data_dir):
        raise ConfigError(
            f"A pasta de dados ({data_dir}) parece estar sincronizada com a nuvem. "
            "O banco em uso não pode ficar em OneDrive, iCloud, Dropbox ou Google Drive. "
            "Use APP_BACKUP_EXTRA_DIR para mandar só as cópias de backup para lá."
        )

    extra_raw = values["APP_BACKUP_EXTRA_DIR"].strip()
    extra_dir = _expand_path(extra_raw) if extra_raw else None
    if extra_dir is not None and extra_dir == data_dir:
        raise ConfigError("APP_BACKUP_EXTRA_DIR precisa ser diferente da pasta de dados.")

    log_level = values["APP_LOG_LEVEL"].strip().upper()
    if log_level not in _LOG_LEVELS:
        raise ConfigError(f"APP_LOG_LEVEL precisa ser um de {sorted(_LOG_LEVELS)}.")

    return Settings(
        app_name=app_name,
        display_name=values["APP_DISPLAY_NAME"].strip() or app_name,
        port=_to_int(values["APP_PORT"], "APP_PORT", 1024, 65000),
        data_dir=data_dir,
        backup_extra_dir=extra_dir,
        backup_keep_daily=_to_int(values["APP_BACKUP_KEEP_DAILY"], "APP_BACKUP_KEEP_DAILY", 1, 365),
        backup_keep_weekly=_to_int(
            values["APP_BACKUP_KEEP_WEEKLY"], "APP_BACKUP_KEEP_WEEKLY", 0, 104
        ),
        open_browser=_to_bool(values["APP_OPEN_BROWSER"], "APP_OPEN_BROWSER"),
        log_level=log_level,
        project_root=PROJECT_ROOT,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()


def reset_settings() -> None:
    """Descarta a configuração em cache (usado nos testes)."""
    get_settings.cache_clear()


def ensure_env_file() -> bool:
    """Cria o .env a partir do .env.example se ainda não existir. Retorna True se criou."""
    target = PROJECT_ROOT / ".env"
    example = PROJECT_ROOT / ".env.example"
    if target.exists() or not example.is_file():
        return False
    target.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    if os.name == "posix":
        target.chmod(0o600)
    return True
