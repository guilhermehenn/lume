"""Cada teste roda com uma pasta de dados temporária e sem ler o .env do projeto."""

import os
import sys

import pytest


def _reset_state() -> None:
    from app.core import config

    config.reset_settings()
    db = sys.modules.get("app.data.db")
    if db is not None:
        db.reset_engine()


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key.startswith("APP_"):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("APP_IGNORE_DOTENV", "1")
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("APP_OPEN_BROWSER", "false")
    _reset_state()
    yield tmp_path / "data"
    _reset_state()
