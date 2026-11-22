#!/bin/bash
# Abre o app no navegador. Para encerrar: Ctrl+C ou feche a janela do Terminal.
cd "$(dirname "$0")" || exit 1
exec /bin/bash ./scripts/iniciar-macos.sh "$@"
