"""Preparação do app antes de abrir: pastas, verificação do banco, backup e migrations.

Ordem (pensada para nunca perder dados):
1. cria as pastas de dados;
2. se o banco já existe, verifica a integridade (quick_check);
3. faz o backup automático do dia;
4. se há migration pendente, faz um backup "pre-migration" e só então migra;
5. garante o usuário local;
6. cofres: verifica cada um, faz o backup do dia e atualiza o esquema (com backup antes).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from app.core import paths
from app.services import backup

log = logging.getLogger(__name__)


class StartupError(Exception):
    """Algo impede o app de abrir com segurança. A mensagem é mostrada ao usuário."""


@dataclass(frozen=True)
class PrepareReport:
    db_path: Path
    created_db: bool
    migrated: bool
    daily_backup: backup.BackupInfo | None
    pre_migration_backup: backup.BackupInfo | None
    vaults: list = field(default_factory=list)  # list[maintenance.VaultReport]


def prepare(*, run_backup: bool) -> PrepareReport:
    from app.data import migrate, seed  # importa aqui: SQLAlchemy/Alembic são pesados

    paths.ensure_dirs()
    db_path = paths.db_file()
    existed = db_path.exists() and db_path.stat().st_size > 0

    daily = None
    if existed:
        status = backup.check_integrity(db_path, quick=True)
        if status != "ok":
            raise StartupError(
                f"O banco de dados não passou na verificação de integridade ({status}). "
                "Nada foi alterado. Para voltar ao último backup bom, rode: "
                "uv run python -m app.cli restore --latest"
            )
        if run_backup:
            try:
                daily = backup.ensure_daily_backup()
            except backup.BackupError as exc:
                raise StartupError(f"O backup automático falhou: {exc}") from exc

    pre_migration = None
    migrated = False
    if migrate.is_pending():
        if existed:
            try:
                pre_migration = backup.create_backup("pre-migration")
            except backup.BackupError as exc:
                raise StartupError(
                    f"Backup antes da atualização do banco falhou; nada foi alterado: {exc}"
                ) from exc
        log.info("Atualizando o esquema do banco...")
        migrate.upgrade()
        migrated = True

    seed.ensure_local_user()
    paths.secure_file(db_path)

    from app.vaults import maintenance

    vaults = maintenance.prepare_vaults(run_backup=run_backup)
    return PrepareReport(
        db_path=db_path,
        created_db=not existed,
        migrated=migrated,
        daily_backup=daily,
        pre_migration_backup=pre_migration,
        vaults=vaults,
    )
