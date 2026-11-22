"""Cuidados com os cofres ao abrir o Lume: integridade, backup do dia e atualização do esquema.

Um cofre com problema não impede os outros de abrir: ele aparece marcado na lista e
o relatório diz o que fazer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.core import paths
from app.core.config import get_settings
from app.services import backup
from app.vaults import registry, store

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class VaultReport:
    vault_id: str
    path: Path
    status: str  # ok | migrated | damaged | too-new
    message: str = ""
    daily_backup: backup.BackupInfo | None = None


def _extra(vault_id: str) -> Path | None:
    extra = get_settings().backup_extra_dir
    return extra / "cofres" / vault_id if extra else None


def daily_backup(path: Path, now: datetime | None = None) -> backup.BackupInfo | None:
    vault_id = path.stem
    folder = registry.vault_backups_dir(vault_id)
    now = now or datetime.now()
    if backup.has_backup_on(now, folder):
        return None
    return backup.create_backup(
        "auto", db_path=path, backups_dir=folder, extra_dir=_extra(vault_id), now=now
    )


def prepare_vaults(*, run_backup: bool, now: datetime | None = None) -> list[VaultReport]:
    registry.ensure_dirs()
    # Ao abrir o app nenhuma criação está em andamento: sobras são de uma criação interrompida.
    if registry.remove_stale_temp_files():
        log.warning("Sobras de uma criação de cofre interrompida foram apagadas")
    reports: list[VaultReport] = []
    for path in registry.vault_files():
        vault_id = path.stem
        status = backup.check_integrity(path, quick=True)
        if status != "ok":
            log.error("Cofre %s não passou na verificação: %s", vault_id, status)
            reports.append(
                VaultReport(
                    vault_id,
                    path,
                    "damaged",
                    f"Não passou na verificação ({status}). Restaure um backup: "
                    f"uv run python -m app.cli restore --cofre {vault_id} --latest",
                )
            )
            continue
        try:
            daily = daily_backup(path, now) if run_backup else None
            with store.connect(path) as conn:
                version = store.schema_version(conn)
                if version > store.SCHEMA_VERSION:
                    reports.append(
                        VaultReport(
                            vault_id, path, "too-new", "Criado por uma versão mais nova do Lume."
                        )
                    )
                    continue
                if version < store.SCHEMA_VERSION:
                    backup.create_backup(
                        "pre-migration",
                        db_path=path,
                        backups_dir=registry.vault_backups_dir(vault_id),
                        extra_dir=_extra(vault_id),
                        now=now,
                    )
                    store.migrate(conn)
                    reports.append(VaultReport(vault_id, path, "migrated", daily_backup=daily))
                    continue
            paths.secure_file(path)
            reports.append(VaultReport(vault_id, path, "ok", daily_backup=daily))
        except (backup.BackupError, store.VaultError, OSError) as exc:
            log.error("Cofre %s: %s", vault_id, exc)
            reports.append(VaultReport(vault_id, path, "damaged", str(exc)))
    return reports
