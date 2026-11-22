#!/bin/bash
# Sobe o app em http://127.0.0.1 e abre o navegador. Chamado pelo iniciar-macos.command.
# Argumentos extras são repassados ao app, por exemplo:  ./iniciar-macos.command --dev
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND="$ROOT/backend"

for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$brew_bin" ]; then
    eval "$("$brew_bin" shellenv)"
    break
  fi
done
export PATH="$HOME/.local/bin:$PATH"
export PYTHONUTF8=1
export PYTHONUNBUFFERED=1

if ! command -v uv >/dev/null 2>&1; then
  echo "O uv não foi encontrado. Rode primeiro o configurar-macos.command."
  exit 1
fi
if [ ! -d "$BACKEND/.venv" ] || [ ! -f "$BACKEND/uv.lock" ]; then
  echo "O ambiente ainda não foi configurado. Rode primeiro o configurar-macos.command."
  exit 1
fi

printf '\033]0;%s\007' "Lume (rodando) - feche esta janela para encerrar"
cd "$BACKEND"
exec uv run --frozen python -m app "$@"
