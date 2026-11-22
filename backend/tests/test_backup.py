import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.core import paths
from app.services import backup


def _make_db(path: Path, rows: int = 3) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.executemany("INSERT INTO t (v) VALUES (?)", [(f"linha {i}",) for i in range(rows)])
    conn.commit()
    conn.close()


def _count(path: Path) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT COUNT(*) FROM t").fetchone()[0]
    finally:
        conn.close()


def test_sem_banco_nao_cria_backup():
    assert backup.create_backup("manual") is None


def test_cria_backup_verificado_e_arquivo_unico():
    db = paths.db_file()
    _make_db(db)
    info = backup.create_backup("manual")
    assert info is not None
    assert info.path.parent == paths.backups_dir()
    assert info.reason == "manual"
    assert backup.check_integrity(info.path) == "ok"
    assert _count(info.path) == 3
    # backup é um arquivo único, sem -wal/-shm nem .partial
    leftovers = [p.name for p in paths.backups_dir().iterdir() if p != info.path]
    assert leftovers == []


def test_backup_com_conexao_aberta_e_dados_nao_commitados():
    db = paths.db_file()
    _make_db(db)
    writer = sqlite3.connect(db)
    writer.execute("INSERT INTO t (v) VALUES ('pendente')")  # sem commit
    try:
        info = backup.create_backup("manual")
    finally:
        writer.rollback()
        writer.close()
    assert info is not None
    assert _count(info.path) == 3


def test_nomes_no_mesmo_segundo_nao_colidem():
    _make_db(paths.db_file())
    now = datetime(2026, 11, 20, 10, 0, 0)
    a = backup.create_backup("manual", now=now, apply_policy=False)
    b = backup.create_backup("manual", now=now, apply_policy=False)
    assert a.path != b.path
    assert b.reason == "manual"


def test_motivo_invalido():
    _make_db(paths.db_file())
    with pytest.raises(backup.BackupError):
        backup.create_backup("../x")


def test_retencao_diaria_e_semanal():
    _make_db(paths.db_file(), rows=1)
    start = datetime(2026, 9, 1, 9, 0, 0)
    for day in range(60):
        for hour in (9, 18):
            backup.create_backup(
                "auto", now=start + timedelta(days=day, hours=hour - 9), apply_policy=False
            )
    removed = backup.apply_retention()
    kept = backup.list_backups()
    assert removed
    days = {b.created_at.date() for b in kept}
    weeks = {b.created_at.isocalendar()[:2] for b in kept}
    newest = max(b.created_at for b in kept)
    assert newest == start + timedelta(days=59, hours=9)
    assert len(days) >= 7
    assert len(weeks) >= 4
    assert len(kept) <= backup.KEEP_LATEST + 7 + 4


def test_retencao_nao_apaga_arquivos_alheios():
    _make_db(paths.db_file())
    folder = paths.backups_dir()
    folder.mkdir(parents=True, exist_ok=True)
    other = folder / "anotacoes.txt"
    other.write_text("meu arquivo", encoding="utf-8")
    for i in range(20):
        backup.create_backup("auto", now=datetime(2026, 1, 1) + timedelta(days=i * 8))
    assert other.exists()


def test_backup_diario_so_uma_vez_por_dia():
    _make_db(paths.db_file())
    now = datetime(2026, 11, 20, 8, 0, 0)
    assert backup.ensure_daily_backup(now) is not None
    assert backup.ensure_daily_backup(now + timedelta(hours=5)) is None
    assert backup.ensure_daily_backup(now + timedelta(days=1)) is not None


def test_copia_extra(tmp_path, monkeypatch):
    from app.core import config

    extra = tmp_path / "pendrive"
    monkeypatch.setenv("APP_BACKUP_EXTRA_DIR", str(extra))
    config.reset_settings()
    _make_db(paths.db_file())
    info = backup.create_backup("manual")
    assert (extra / info.path.name).is_file()


def test_detecta_banco_corrompido(tmp_path):
    bad = tmp_path / "ruim.db"
    bad.write_bytes(b"isto nao e um banco sqlite" * 100)
    assert backup.check_integrity(bad) != "ok"


def test_restaura_backup_e_guarda_estado_anterior():
    db = paths.db_file()
    _make_db(db, rows=2)
    good = backup.create_backup("manual", now=datetime(2026, 11, 1, 12, 0, 0))
    _make_db(db, rows=5)  # agora o banco tem 7 linhas
    assert _count(db) == 7

    safety = backup.restore_backup(good.path)
    assert _count(db) == 2
    assert safety is not None and safety.reason == "pre-restore"
    assert _count(safety.path) == 7


def test_restaurar_arquivo_corrompido_nao_mexe_no_banco(tmp_path):
    db = paths.db_file()
    _make_db(db, rows=4)
    bad = tmp_path / "ruim.db"
    bad.write_bytes(b"x" * 4096)
    with pytest.raises(backup.BackupError):
        backup.restore_backup(bad)
    assert _count(db) == 4


def test_resolve_backup_por_nome():
    _make_db(paths.db_file())
    info = backup.create_backup("manual")
    assert backup.resolve_backup(info.path.name) == info.path
    with pytest.raises(backup.BackupError):
        backup.resolve_backup("nao-existe.db")
