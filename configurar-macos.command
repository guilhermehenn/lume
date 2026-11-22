#!/bin/bash
# Configura o ambiente no macOS. Na primeira vez, rode pelo Terminal:
#   bash configurar-macos.command
# Depois disso, o clique duplo também funciona.
cd "$(dirname "$0")" || exit 1
/bin/bash ./setup/setup-macos.sh "$@"
status=$?
echo
if [ "$status" -eq 0 ]; then
  echo "Pronto. Pode fechar esta janela e abrir o app pelo iniciar-macos.command."
else
  echo "A configuração terminou com erro (código $status). Veja o log na pasta setup/logs."
fi
exit "$status"
