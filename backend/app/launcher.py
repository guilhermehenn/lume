"""Inicia o app: prepara o banco, sobe o servidor em 127.0.0.1 e abre o navegador.

Uso (a partir de backend/):  uv run python -m app [--dev] [--no-browser] [--port 8765]
"""

from __future__ import annotations

import argparse
import json
import logging
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

from app import __version__
from app.core.config import APP_DIR, HOST, SERVICE_ID, ConfigError, get_settings

log = logging.getLogger("app.launcher")

# Sem proxy: o endereço é sempre local.
_LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORT_ATTEMPTS = 20


def base_url(port: int) -> str:
    return f"http://{HOST}:{port}/"


def is_app_running(port: int, timeout: float = 1.0) -> bool:
    """True se já existe uma instância DESTE app respondendo nessa porta."""
    try:
        with _LOCAL_OPENER.open(f"{base_url(port)}api/health", timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(data, dict) and data.get("service") == SERVICE_ID


def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind((HOST, port))
        except OSError:
            return False
    return True


def find_free_port(preferred: int, attempts: int = PORT_ATTEMPTS) -> int:
    for port in range(preferred, min(preferred + attempts, 65536)):
        if is_port_free(port):
            return port
    raise RuntimeError(
        f"Nenhuma porta livre entre {preferred} e {preferred + attempts - 1}. "
        "Feche outros programas ou mude APP_PORT no arquivo .env."
    )


def open_when_ready(port: int, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if is_app_running(port, timeout=0.5):
            webbrowser.open(base_url(port), new=2)
            return
        time.sleep(0.25)
    log.warning("O servidor demorou para responder. Abra manualmente: %s", base_url(port))


def _banner(display_name: str, url: str, data_dir: str, note: str | None) -> str:
    line = "─" * 52
    rows = [
        "",
        f"  {display_name} {__version__}",
        f"  {line}",
        f"  Endereço:  {url}",
        f"  Dados:     {data_dir}",
    ]
    if note:
        rows.append(f"  Backup:    {note}")
    rows += ["  Encerrar:  Ctrl+C (ou feche esta janela)", f"  {line}", ""]
    return "\n".join(rows)


def missing_dependencies() -> list[str]:
    """Bibliotecas novas que podem faltar se o setup não foi rodado de novo após atualizar."""
    import importlib.util

    return [name for name in ("cryptography",) if importlib.util.find_spec(name) is None]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app", description="Inicia o app no navegador.")
    parser.add_argument(
        "--dev", action="store_true", help="recarrega o servidor ao salvar arquivos"
    )
    parser.add_argument("--no-browser", action="store_true", help="não abre o navegador")
    parser.add_argument("--port", type=int, help="porta preferida (padrão: APP_PORT do .env)")
    args = parser.parse_args(argv)

    missing = missing_dependencies()
    if missing:
        print(
            "Faltam bibliotecas novas desta versão do Lume (" + ", ".join(missing) + ").\n"
            "Rode de novo o configurar-windows.bat (Windows)"
            " ou o configurar-macos.command (macOS).",
            file=sys.stderr,
        )
        return 1

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(f"Erro de configuração: {exc}", file=sys.stderr)
        return 2

    from app.core import paths
    from app.core.log_setup import setup_logging

    paths.ensure_dirs()
    setup_logging(settings.log_level, paths.logs_dir())
    want_browser = settings.open_browser and not args.no_browser
    preferred = args.port or settings.port

    if is_app_running(preferred):
        print(f"O app já está aberto em {base_url(preferred)}")
        if want_browser:
            webbrowser.open(base_url(preferred), new=2)
        return 0

    from app.bootstrap import StartupError, prepare

    try:
        report = prepare(run_backup=True)
    except StartupError as exc:
        log.error("%s", exc)
        return 1

    port = find_free_port(preferred)
    if port != preferred:
        log.warning("A porta %s está ocupada; usando %s.", preferred, port)

    if report.created_db:
        note = "banco novo criado"
    elif report.daily_backup:
        note = report.daily_backup.path.name
    else:
        note = "backup de hoje já existe"
    print(_banner(settings.display_name, base_url(port), str(settings.data_dir), note))

    if want_browser:
        threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()

    import uvicorn

    common = {
        "host": HOST,
        "port": port,
        "log_config": None,
        "log_level": settings.log_level.lower(),
        "server_header": False,
    }
    if args.dev:
        uvicorn.run(
            "app.main:create_app",
            factory=True,
            reload=True,
            reload_dirs=[str(APP_DIR)],
            **common,
        )
    else:
        from app.main import create_app

        uvicorn.run(create_app(), access_log=False, **common)
    return 0
