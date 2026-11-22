"""Backups do banco SQLite.

Regras:
- a cópia usa a API de backup do próprio SQLite, que é segura com o app aberto;
- cada cópia é gravada primeiro como ``.partial``, verificada (integrity_check)
  e só então renomeada: um backup com nome final é sempre um backup íntegro;
- retenção: os 3 mais recentes + o último de cada um dos N dias + o último de
  cada uma das M semanas (padrão 7 e 4);
- só arquivos com o padrão de nome deste módulo são apagados pela retenção.
"""

from __future__ import annotations

import contextlib
import logging
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.core import paths
from app.core.config import get_settings

log = logging.getLogger(__name__)

KEEP_LATEST = 3
_TS_FORMAT = "%Y-%m-%d_%H-%M-%S"
_NAME_RE = re.compile(
    r"^(?P<stem>[A-Za-z0-9_-]+?)_(?P<ts>\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})"
    r"_(?P<reason>[a-z][a-z0-9-]*)\.db$"
)
_REASON_RE = re.compile(r"^[a-z][a-z-]{0,30}$")


class BackupError(Exception):
    """Falha ao criar, verificar ou restaurar um backup."""


@dataclass(frozen=True)
class BackupInfo:
    path: Path
    created_at: datetime
    reason: str
    size_bytes: int

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.path.name,
            "created_at": self.created_at.isoformat(timespec="seconds"),
            "reason": self.reason,
            "size_bytes": self.size_bytes,
        }


def check_integrity(db_path: Path, *, quick: bool = False) -> str:
    """Roda PRAGMA integrity_check (ou quick_check) em modo somente leitura. "ok" = íntegro."""
    pragma = "quick_check" if quick else "integrity_check"
    uri = f"{db_path.resolve().as_uri()}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=10)
        try:
            rows = conn.execute(f"PRAGMA {pragma}").fetchall()
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        return f"erro: {exc}"
    result = "; ".join(str(row[0]) for row in rows[:5])
    return result or "erro: sem resposta"


def parse_backup_name(path: Path) -> BackupInfo | None:
    match = _NAME_RE.match(path.name)
    if not match:
        return None
    try:
        created = datetime.strptime(match["ts"], _TS_FORMAT)
        size = path.stat().st_size
    except (ValueError, OSError):
        return None
    reason = re.sub(r"-\d+$", "", match["reason"])
    return BackupInfo(path=path, created_at=created, reason=reason, size_bytes=size)


def list_backups(folder: Path | None = None) -> list[BackupInfo]:
    """Backups do mais novo para o mais antigo."""
    folder = folder or paths.backups_dir()
    if not folder.is_dir():
        return []
    found = (parse_backup_name(p) for p in folder.iterdir() if p.is_file())
    backups = [b for b in found if b is not None]
    return sorted(backups, key=lambda b: (b.created_at, b.path.name), reverse=True)


def _unique_target(folder: Path, stem: str, stamp: str, reason: str) -> Path:
    target = folder / f"{stem}_{stamp}_{reason}.db"
    counter = 2
    while target.exists():
        target = folder / f"{stem}_{stamp}_{reason}-{counter}.db"
        counter += 1
    return target


def _remove_sidecars(db_path: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = Path(f"{db_path}{suffix}")
        if sidecar.exists():
            sidecar.unlink()


def create_backup(
    reason: str = "manual",
    *,
    db_path: Path | None = None,
    backups_dir: Path | None = None,
    extra_dir: Path | None = None,
    now: datetime | None = None,
    apply_policy: bool = True,
) -> BackupInfo | None:
    """Cria um backup verificado. Retorna None se ainda não existe banco."""
    if not _REASON_RE.match(reason):
        raise BackupError(f"Motivo de backup inválido: {reason!r}.")
    settings = get_settings()
    db_path = db_path or paths.db_file()
    backups_dir = backups_dir or paths.backups_dir()
    if extra_dir is None:
        extra_dir = settings.backup_extra_dir

    if not db_path.exists() or db_path.stat().st_size == 0:
        return None

    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now()).strftime(_TS_FORMAT)
    target = _unique_target(backups_dir, db_path.stem, stamp, reason)
    partial = target.with_name(target.name + ".partial")

    try:
        source = sqlite3.connect(db_path, timeout=10)
        try:
            dest = sqlite3.connect(partial)
            try:
                source.backup(dest)
                dest.execute("PRAGMA journal_mode=DELETE")
                dest.commit()
            finally:
                dest.close()
        finally:
            source.close()
        _remove_sidecars(partial)

        status = check_integrity(partial)
        if status != "ok":
            raise BackupError(f"O backup gerado não passou na verificação: {status}")
        partial.replace(target)
    except (sqlite3.Error, OSError) as exc:
        raise BackupError(f"Não foi possível criar o backup: {exc}") from exc
    finally:
        if partial.exists():
            partial.unlink()
        _remove_sidecars(partial)

    paths.secure_file(target)
    info = parse_backup_name(target)
    if info is None:  # pragma: no cover - nome gerado aqui sempre bate com o padrão
        raise BackupError("Nome de backup inesperado.")
    log.info("Backup criado: %s", target.name)

    if extra_dir is not None:
        _copy_to_extra(target, extra_dir)

    if apply_policy:
        apply_retention(backups_dir)
        if extra_dir is not None and extra_dir.is_dir():
            apply_retention(extra_dir)
    return info


def _copy_to_extra(backup: Path, extra_dir: Path) -> None:
    """Cópia extra fora da máquina (OneDrive, iCloud, pendrive). Falha aqui só gera aviso."""
    try:
        extra_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, extra_dir / backup.name)
        log.info("Cópia extra gravada em %s", extra_dir)
    except OSError as exc:
        log.warning("Não foi possível copiar o backup para %s: %s", extra_dir, exc)


def select_to_keep(
    backups: list[BackupInfo], keep_daily: int, keep_weekly: int, keep_latest: int = KEEP_LATEST
) -> set[Path]:
    ordered = sorted(backups, key=lambda b: (b.created_at, b.path.name), reverse=True)
    keep = {b.path for b in ordered[:keep_latest]}

    days: list[object] = []
    weeks: list[object] = []
    for b in ordered:
        day = b.created_at.date()
        if day not in days:
            days.append(day)
            if len(days) <= keep_daily:
                keep.add(b.path)
        week = b.created_at.isocalendar()[:2]
        if week not in weeks:
            weeks.append(week)
            if len(weeks) <= keep_weekly:
                keep.add(b.path)
    return keep


def apply_retention(folder: Path | None = None) -> list[Path]:
    """Apaga backups antigos fora da política. Retorna os arquivos removidos."""
    settings = get_settings()
    folder = folder or paths.backups_dir()
    backups = list_backups(folder)
    keep = select_to_keep(backups, settings.backup_keep_daily, settings.backup_keep_weekly)
    removed: list[Path] = []
    for b in backups:
        if b.path not in keep:
            try:
                b.path.unlink()
                removed.append(b.path)
            except OSError as exc:
                log.warning("Não foi possível apagar o backup antigo %s: %s", b.path.name, exc)
    for leftover in folder.glob("*.partial"):
        with contextlib.suppress(OSError):
            leftover.unlink()
    return removed


def has_backup_on(day: datetime, folder: Path | None = None) -> bool:
    return any(b.created_at.date() == day.date() for b in list_backups(folder))


def ensure_daily_backup(now: datetime | None = None) -> BackupInfo | None:
    """Faz o backup automático do dia, se ainda não houver um."""
    now = now or datetime.now()
    if has_backup_on(now):
        return None
    return create_backup("auto", now=now)


def resolve_backup(name_or_path: str, folder: Path | None = None) -> Path:
    """Aceita um nome de arquivo da pasta de backups ou um caminho completo."""
    candidate = Path(name_or_path).expanduser()
    if not candidate.is_absolute():
        candidate = (folder or paths.backups_dir()) / candidate.name
    if not candidate.is_file():
        raise BackupError(f"Backup não encontrado: {candidate}")
    return candidate


def restore_backup(
    backup_path: Path,
    *,
    db_path: Path | None = None,
    backups_dir: Path | None = None,
    extra_dir: Path | None = None,
) -> BackupInfo | None:
    """Restaura um backup sobre o banco atual. O app precisa estar fechado.

    Antes, salva o estado atual como backup "pre-restore". Retorna esse backup de segurança.
    """
    db_path = db_path or paths.db_file()
    status = check_integrity(backup_path)
    if status != "ok":
        raise BackupError(f"O arquivo escolhido não é um backup íntegro: {status}")

    safety = create_backup(
        "pre-restore",
        db_path=db_path,
        backups_dir=backups_dir,
        extra_dir=extra_dir,
        apply_policy=False,
    )

    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        source = sqlite3.connect(f"{backup_path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            dest = sqlite3.connect(db_path, timeout=10)
            try:
                source.backup(dest)
                dest.execute("PRAGMA journal_mode=WAL")
                dest.commit()
            finally:
                dest.close()
        finally:
            source.close()
    except sqlite3.Error as exc:
        raise BackupError(f"Falha ao restaurar: {exc}") from exc

    status = check_integrity(db_path)
    if status != "ok":
        raise BackupError(f"O banco restaurado não passou na verificação: {status}")
    paths.secure_file(db_path)
    log.info("Backup restaurado: %s", backup_path.name)
    return safety
