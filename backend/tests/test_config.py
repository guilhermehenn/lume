from pathlib import Path

import pytest

from app.core.config import (
    PROJECT_ROOT,
    ConfigError,
    is_cloud_synced,
    load_settings,
    read_env_file,
)


def _env(tmp_path: Path, **extra: str) -> dict[str, str]:
    base = {"APP_IGNORE_DOTENV": "1", "APP_DATA_DIR": str(tmp_path / "dados")}
    base.update(extra)
    return base


def test_padroes(tmp_path):
    s = load_settings(_env(tmp_path))
    assert s.app_name == "Lume"
    assert s.port == 8765
    assert s.backup_keep_daily == 7
    assert s.backup_keep_weekly == 4
    assert s.backup_extra_dir is None
    assert s.data_dir == (tmp_path / "dados").resolve()


def test_pasta_padrao_usa_nome_do_app(tmp_path):
    s = load_settings({"APP_IGNORE_DOTENV": "1", "APP_NAME": "MeuApp"})
    assert s.data_dir.name == "MeuApp"


def test_le_arquivo_env(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        '# comentário\nAPP_PORT=9000\nAPP_DISPLAY_NAME="Minhas Finanças"\nOUTRA=ignorada\n',
        encoding="utf-8",
    )
    values = read_env_file(env_file)
    assert values == {"APP_PORT": "9000", "APP_DISPLAY_NAME": "Minhas Finanças"}


@pytest.mark.parametrize(
    "extra",
    [
        {"APP_PORT": "80"},
        {"APP_PORT": "abc"},
        {"APP_NAME": "../fora"},
        {"APP_NAME": "Finanças"},
        {"APP_OPEN_BROWSER": "talvez"},
        {"APP_LOG_LEVEL": "VERBOSE"},
        {"APP_BACKUP_KEEP_DAILY": "0"},
    ],
)
def test_valores_invalidos(tmp_path, extra):
    with pytest.raises(ConfigError):
        load_settings(_env(tmp_path, **extra))


@pytest.mark.parametrize(
    "path",
    [
        "C:/Users/ana/OneDrive/Financas",
        "/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/x",
        "/Users/ana/Library/CloudStorage/GoogleDrive-ana/x",
        "/Users/ana/Dropbox/x",
    ],
)
def test_detecta_pasta_sincronizada(path):
    assert is_cloud_synced(Path(path))


def test_recusa_banco_em_pasta_sincronizada(tmp_path):
    with pytest.raises(ConfigError):
        load_settings(_env(tmp_path, APP_DATA_DIR=str(tmp_path / "OneDrive" / "dados")))


def test_env_example_do_projeto_e_valido():
    values = read_env_file(PROJECT_ROOT / ".env.example")
    assert values["APP_NAME"] == "Lume"
    s = load_settings({"APP_IGNORE_DOTENV": "1", **values})
    assert s.port == 8765
    assert s.backup_extra_dir is None


def test_backup_extra_pode_ficar_na_nuvem(tmp_path):
    extra = tmp_path / "OneDrive" / "backups"
    s = load_settings(_env(tmp_path, APP_BACKUP_EXTRA_DIR=str(extra)))
    assert s.backup_extra_dir == extra.resolve()
