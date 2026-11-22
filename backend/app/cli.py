"""Ferramentas de manutenção.

Uso (a partir de backend/):
    uv run python -m app.cli setup              prepara pastas, .env, banco e backup
    uv run python -m app.cli doctor             verifica se está tudo saudável
    uv run python -m app.cli info               mostra caminhos e configurações
    uv run python -m app.cli backup             cria um backup agora
    uv run python -m app.cli backups            lista os backups
    uv run python -m app.cli restore --latest   restaura o backup mais recente
    uv run python -m app.cli restore ARQUIVO    restaura um backup específico
    uv run python -m app.cli cofres             lista os cofres
    uv run python -m app.cli redefinir-senha --cofre ID   nova senha para um cofre (app fechado)

    backup, backups e restore aceitam --cofre ID para trabalhar com um cofre.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
from datetime import datetime

from app import __version__
from app.core.config import HOST, PROJECT_ROOT, ConfigError, ensure_env_file, get_settings

MIN_PYTHON = (3, 13)
MIN_SQLITE = (3, 35, 0)


def _line(state: str, text: str) -> None:
    print(f"  [{state:^5}] {text}")


def _size(num: int) -> str:
    value = float(num)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{num} B"


def cmd_setup(_args: argparse.Namespace) -> int:
    if ensure_env_file():
        print("  .env criado a partir do .env.example")
    from app.bootstrap import StartupError, prepare
    from app.core import paths

    try:
        report = prepare(run_backup=True)
    except StartupError as exc:
        print(f"  ERRO: {exc}", file=sys.stderr)
        return 1
    settings = get_settings()
    print(f"  Pasta de dados: {settings.data_dir}")
    state = "criado agora" if report.created_db else "já existia"
    print(f"  Banco:          {report.db_path} ({state})")
    print(f"  Backups:        {paths.backups_dir()}")
    if report.migrated:
        print("  Esquema do banco atualizado (migrations aplicadas).")
    if report.daily_backup:
        print(f"  Backup do dia:  {report.daily_backup.path.name}")
    if report.vaults:
        problems = [v for v in report.vaults if v.status in ("damaged", "too-new")]
        print(f"  Cofres:         {len(report.vaults)} ({len(problems)} com problema)")
        for v in problems:
            print(f"    {v.vault_id}: {v.message}")
    return 0


def cmd_info(_args: argparse.Namespace) -> int:
    from app.core import paths

    s = get_settings()
    print(f"  App:            {s.display_name} {__version__} (id: {s.app_name})")
    print(f"  Projeto:        {PROJECT_ROOT}")
    print(f"  Endereço:       http://{HOST}:{s.port}/")
    print(f"  Pasta de dados: {s.data_dir}")
    print(f"  Banco:          {paths.db_file()}")
    print(f"  Backups:        {paths.backups_dir()}")
    print(f"  Cópia extra:    {s.backup_extra_dir or 'desativada'}")
    print(f"  Retenção:       {s.backup_keep_daily} diários + {s.backup_keep_weekly} semanais")
    print(f"  Logs:           {paths.logs_dir()}")
    return 0


def _vault_target(args: argparse.Namespace):  # noqa: ANN202 - (Path, Path, Path | None) | None
    """Para --cofre: (arquivo do cofre, pasta de backups, cópia extra). None sem --cofre."""
    ident = getattr(args, "cofre", None)
    if not ident:
        return None
    from app.vaults import maintenance, registry

    matches = [
        v
        for v in registry.list_vaults()
        if v.id == ident or v.id.startswith(ident) or v.name.lower() == ident.lower()
    ]
    if len(matches) != 1:
        raise SystemExit(
            f"  Cofre não encontrado ou ambíguo: {ident}."
            " Veja a lista com: uv run python -m app.cli cofres"
        )
    vault_id = matches[0].id
    return (
        registry.vaults_dir() / f"{vault_id}.db",
        registry.vault_backups_dir(vault_id),
        maintenance._extra(vault_id),
    )


def cmd_backup(args: argparse.Namespace) -> int:
    from app.services import backup

    target = _vault_target(args)
    try:
        if target:
            info = backup.create_backup(
                "manual", db_path=target[0], backups_dir=target[1], extra_dir=target[2]
            )
        else:
            info = backup.create_backup("manual")
    except backup.BackupError as exc:
        print(f"  ERRO: {exc}", file=sys.stderr)
        return 1
    if info is None:
        print("  Ainda não há banco de dados para copiar.")
        return 0
    print(f"  Backup criado: {info.path} ({_size(info.size_bytes)})")
    return 0


def cmd_backups(args: argparse.Namespace) -> int:
    from app.services import backup

    target = _vault_target(args)
    items = backup.list_backups(target[1] if target else None)
    if not items:
        print("  Nenhum backup ainda.")
        return 0
    for b in items:
        when = b.created_at.strftime("%d/%m/%Y %H:%M:%S")
        print(f"  {when}  {b.reason:<14} {_size(b.size_bytes):>9}  {b.path.name}")
    return 0


def cmd_vaults(_args: argparse.Namespace) -> int:
    from app.vaults import registry

    items = registry.list_vaults()
    if not items:
        print("  Nenhum cofre ainda. Crie o primeiro na tela inicial do Lume.")
        return 0
    for v in items:
        owner = f"{v.owner_first_name} {v.owner_last_name}".strip() or "?"
        state = {
            "ok": "",
            "needs-update": " (será atualizado)",
            "too-new": " (versão mais nova)",
            "error": " (ILEGÍVEL)",
        }
        print(
            f"  {v.id}  {v.name:<24} {owner:<24} {v.entries:>6} lançamentos"
            f"{state.get(v.status, '')}"
        )
    print(f"\n  Pasta: {registry.vaults_dir()}")
    return 0


def cmd_reset_password(args: argparse.Namespace) -> int:
    import getpass

    from app.launcher import is_app_running
    from app.vaults import registry, service

    if is_app_running(get_settings().port):
        print("  O app está aberto. Feche-o (Ctrl+C na janela dele) antes de trocar a senha.")
        return 1
    target = _vault_target(args)
    assert target is not None  # noqa: S101 - --cofre é obrigatório neste comando
    vault_id = target[0].stem
    summary = registry.summary(target[0])
    print(f"  Cofre: {summary.name} ({summary.owner_first_name} · {summary.email_hint})")
    print("  A senha do e-mail de envio (se houver) precisará ser digitada de novo em Minha conta.")
    if args.senha is not None:
        new = args.senha
    else:
        if not sys.stdin.isatty():
            print("  Rode num terminal interativo ou use --senha.")
            return 1
        new = getpass.getpass("  Nova senha: ")
        if getpass.getpass("  Repita a nova senha: ") != new:
            print("  As senhas não conferem. Nada foi alterado.")
            return 1
    try:
        service.reset_password_offline(vault_id, new)
    except Exception as exc:  # noqa: BLE001 - mensagem amigável para qualquer falha
        code = getattr(exc, "code", "")
        msg = (
            "A senha precisa ter pelo menos 8 caracteres."
            if code.startswith("weak-password")
            else str(exc)
        )
        print(f"  ERRO: {msg}", file=sys.stderr)
        return 1
    print("  Senha trocada. Um backup do cofre foi feito antes.")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    from app.launcher import is_app_running
    from app.services import backup

    settings = get_settings()
    if is_app_running(settings.port):
        print("  O app está aberto. Feche-o (Ctrl+C na janela dele) antes de restaurar.")
        return 1
    target = _vault_target(args)
    folder = target[1] if target else None
    if args.latest:
        items = backup.list_backups(folder)
        if not items:
            print("  Nenhum backup encontrado.")
            return 1
        chosen = items[0].path
    else:
        try:
            chosen = backup.resolve_backup(args.arquivo, folder)
        except backup.BackupError as exc:
            print(f"  ERRO: {exc}", file=sys.stderr)
            return 1

    print(f"  Backup escolhido: {chosen.name}")
    print("  O banco atual será salvo antes como backup 'pre-restore'.")
    if not args.yes:
        if not sys.stdin.isatty():
            print("  Use --yes para confirmar em modo não interativo.")
            return 1
        answer = input("  Confirmar restauração? Digite SIM: ").strip().upper()
        if answer != "SIM":
            print("  Cancelado. Nada foi alterado.")
            return 1

    db_module = sys.modules.get("app.data.db")
    if db_module is not None:  # fecha conexões abertas antes de sobrescrever o banco
        db_module.reset_engine()
    try:
        if target:
            safety = backup.restore_backup(
                chosen, db_path=target[0], backups_dir=target[1], extra_dir=target[2]
            )
        else:
            safety = backup.restore_backup(chosen)
    except backup.BackupError as exc:
        print(f"  ERRO: {exc}", file=sys.stderr)
        return 1
    if safety:
        print(f"  Estado anterior salvo em: {safety.path.name}")
    print("  Restauração concluída.")
    return 0


def cmd_doctor(_args: argparse.Namespace) -> int:
    from app.core import paths
    from app.launcher import is_app_running, is_port_free
    from app.services import backup

    failures = 0
    s = get_settings()

    if sys.version_info[:2] >= MIN_PYTHON:
        _line("ok", f"Python {sys.version.split()[0]}")
    else:
        failures += 1
        _line("falha", f"Python {sys.version.split()[0]} (precisa de 3.13+)")

    sqlite_version = tuple(int(p) for p in sqlite3.sqlite_version.split("."))
    if sqlite_version >= MIN_SQLITE:
        _line("ok", f"SQLite {sqlite3.sqlite_version}")
    else:
        failures += 1
        _line("falha", f"SQLite {sqlite3.sqlite_version} (precisa de 3.35+)")

    try:
        paths.ensure_dirs()
        with tempfile.NamedTemporaryFile(dir=s.data_dir, prefix=".write-test-", delete=True):
            pass
        _line("ok", f"Pasta de dados gravável: {s.data_dir}")
    except OSError as exc:
        failures += 1
        _line("falha", f"Não consigo gravar na pasta de dados: {exc}")

    db = paths.db_file()
    if db.exists():
        status = backup.check_integrity(db)
        if status == "ok":
            _line("ok", "Banco íntegro (integrity_check)")
        else:
            failures += 1
            _line("falha", f"Banco com problema: {status}")
        from app.data import migrate
        from app.data.db import get_engine

        with get_engine().connect() as conn:
            mode = conn.exec_driver_sql("PRAGMA journal_mode").scalar()
            fks = conn.exec_driver_sql("PRAGMA foreign_keys").scalar()
        _line("ok" if mode == "wal" else "aviso", f"Modo do diário: {mode}")
        if fks:
            _line("ok", "Chaves estrangeiras ativas")
        else:
            failures += 1
            _line("falha", "Chaves estrangeiras desligadas")
        if migrate.is_pending():
            _line("aviso", "Há migrations pendentes (serão aplicadas ao iniciar o app)")
        else:
            _line("ok", f"Esquema do banco atualizado (revisão {migrate.current_revision()})")
    else:
        _line("aviso", "Banco ainda não criado (rode o setup ou inicie o app)")

    items = backup.list_backups()
    if items:
        age_days = (datetime.now() - items[0].created_at).days
        state = "ok" if age_days <= 1 else "aviso"
        _line(state, f"{len(items)} backup(s); o mais recente tem {age_days} dia(s)")
    else:
        _line("aviso", "Nenhum backup ainda")

    if s.backup_extra_dir:
        writable = s.backup_extra_dir.is_dir() and os.access(s.backup_extra_dir, os.W_OK)
        _line("ok" if writable else "aviso", f"Cópia extra de backup: {s.backup_extra_dir}")

    if is_app_running(s.port):
        _line("ok", f"App rodando em http://{HOST}:{s.port}/")
    elif is_port_free(s.port):
        _line("ok", f"Porta {s.port} livre")
    else:
        _line("aviso", f"Porta {s.port} ocupada por outro programa (o app usará a próxima livre)")

    dist = PROJECT_ROOT / "frontend" / "dist" / "index.html"
    front = "Front-end compilado encontrado" if dist.is_file() else "Front-end ainda não criado"
    _line("info", front)

    print()
    print("  Tudo certo." if failures == 0 else f"  {failures} problema(s) encontrado(s).")
    return 0 if failures == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Manutenção do app.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("setup", help="prepara pastas, .env, banco e backup").set_defaults(fn=cmd_setup)
    sub.add_parser("doctor", help="verifica se está tudo saudável").set_defaults(fn=cmd_doctor)
    sub.add_parser("info", help="mostra caminhos e configurações").set_defaults(fn=cmd_info)
    backup_cmd = sub.add_parser("backup", help="cria um backup agora")
    backup_cmd.add_argument("--cofre", help="id ou nome do cofre")
    backup_cmd.set_defaults(fn=cmd_backup)
    backups_cmd = sub.add_parser("backups", help="lista os backups")
    backups_cmd.add_argument("--cofre", help="id ou nome do cofre")
    backups_cmd.set_defaults(fn=cmd_backups)
    sub.add_parser("cofres", help="lista os cofres").set_defaults(fn=cmd_vaults)
    reset = sub.add_parser("redefinir-senha", help="nova senha para um cofre (com o app fechado)")
    reset.add_argument("--cofre", required=True, help="id ou nome do cofre")
    reset.add_argument(
        "--senha", help="nova senha (sem perguntar; evite, fica no histórico do terminal)"
    )
    reset.set_defaults(fn=cmd_reset_password)
    restore = sub.add_parser("restore", help="restaura um backup (com o app fechado)")
    target = restore.add_mutually_exclusive_group(required=True)
    target.add_argument("arquivo", nargs="?", help="nome do arquivo de backup ou caminho completo")
    target.add_argument("--latest", action="store_true", help="usa o backup mais recente")
    restore.add_argument("--yes", action="store_true", help="não pede confirmação")
    restore.add_argument("--cofre", help="id ou nome do cofre")
    restore.set_defaults(fn=cmd_restore)

    args = parser.parse_args(argv)
    try:
        return args.fn(args)
    except ConfigError as exc:
        print(f"Erro de configuração: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
