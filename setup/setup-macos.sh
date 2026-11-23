#!/bin/bash
# Configura o ambiente completo do projeto no macOS (12 Monterey ou mais novo).
#
# Instala o que faltar e prepara o projeto para rodar:
#   - Homebrew (com sua confirmação)  gerenciador de pacotes padrão do macOS
#   - Git                             Xcode Command Line Tools ou Homebrew
#   - uv (gerenciador do Python)      Homebrew ou instalador oficial da Astral
#   - Python 3.13                     via uv (isolado, não mexe no Python do sistema)
#   - Node.js LTS (front-end)         Homebrew
#   - interface (front-end)           npm install, testes e compilação
#   - dependências do back-end        uv sync com versões travadas (uv.lock)
#   - banco SQLite local + backup     python -m app.cli setup
#   - testes automáticos e verificação final
#
# Pode rodar quantas vezes quiser: o que já está instalado é mantido.
# Compatível com o bash 3.2 que vem no macOS.
#
# Uso:  bash setup/setup-macos.sh [opções]
#   --sim, -y          responde "sim" às confirmações (ex.: instalar o Homebrew)
#   --com-vscode       também instala o Visual Studio Code
#   --pular-testes     não roda os testes automáticos
#   --sem-ferramentas  não instala programas; só prepara o projeto (exige uv)

set -Eeuo pipefail

PYTHON_VERSION="3.13"
MIN_UV="0.5.0"
MIN_NODE_MAJOR=22
MIN_FREE_GB=2
MARK_BEGIN="# >>> lume (gerado pelo setup do projeto) >>>"
MARK_END="# <<< lume <<<"

ASSUME_YES=0
WITH_VSCODE=0
SKIP_TESTS=0
NO_TOOLS=0

usage() {
  sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --sim | -y | --yes) ASSUME_YES=1 ;;
    --com-vscode) WITH_VSCODE=1 ;;
    --pular-testes) SKIP_TESTS=1 ;;
    --sem-ferramentas) NO_TOOLS=1 ;;
    -h | --help | --ajuda)
      usage
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
# Pacote da release: a interface já vem compilada, sem o código do front-end nem os testes.
PACKAGE=0
if [ ! -f "$FRONTEND/package.json" ] && [ -f "$FRONTEND/dist/index.html" ]; then PACKAGE=1; fi
LOG_DIR="$ROOT/setup/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/setup-macos_$(date +%Y-%m-%d_%H-%M-%S).log"

if [ -t 1 ]; then
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_RESET=$'\033[0m'
else
  C_CYAN="" C_GREEN="" C_YELLOW="" C_RED="" C_RESET=""
fi

# Tudo que aparece na tela também vai para o log.
exec > >(tee -a "$LOG_FILE") 2>&1

export PYTHONUTF8=1
export PYTHONUNBUFFERED=1
export HOMEBREW_NO_ENV_HINTS=1

WARNINGS=""
BREW=""
PROFILE_LINES=""

step() { printf '\n%s==> %s%s\n' "$C_CYAN" "$1" "$C_RESET"; }
ok() { printf '    %s[ok]%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
info() { printf '    %s\n' "$1"; }
warn() {
  printf '    %s[aviso]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"
  WARNINGS="${WARNINGS}  - $1"$'\n'
}
die() {
  printf '\n%sERRO:%s %s\n' "$C_RED" "$C_RESET" "$1"
  printf 'Log completo: %s\n' "$LOG_FILE"
  exit 1
}

on_error() {
  local code=$?
  printf '\n%sERRO%s: um comando falhou (linha %s, código %s). Veja as mensagens acima.\n' \
    "$C_RED" "$C_RESET" "$1" "$code"
  printf 'Log completo: %s\n' "$LOG_FILE"
  exit "$code"
}
trap 'on_error $LINENO' ERR

confirm() {
  local answer
  if [ "$ASSUME_YES" -eq 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    return 1
  fi
  printf '    %s [s/N] ' "$1"
  read -r answer || return 1
  case "$answer" in
    s | S | sim | Sim | SIM | y | Y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

extract_version() {
  local re='([0-9]+)\.([0-9]+)\.([0-9]+)'
  if [[ "$1" =~ $re ]]; then
    echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
  fi
}

# version_ge A B  ->  verdadeiro se A >= B (formato X.Y.Z)
version_ge() {
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$1"
  IFS=. read -r b1 b2 b3 <<<"$2"
  a1=${a1:-0} a2=${a2:-0} a3=${a3:-0} b1=${b1:-0} b2=${b2:-0} b3=${b3:-0}
  if [ "$a1" -ne "$b1" ]; then [ "$a1" -gt "$b1" ]; return; fi
  if [ "$a2" -ne "$b2" ]; then [ "$a2" -gt "$b2" ]; return; fi
  [ "$a3" -ge "$b3" ]
}

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi
  local candidate
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 0
}

download_and_run() {
  # Baixa o instalador para um arquivo temporário (nunca executa um download pela metade).
  local url="$1" shell="$2" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/lume-installer.XXXXXX")"
  if ! curl -fsSL --retry 3 --proto '=https' --tlsv1.2 -o "$tmp" "$url"; then
    rm -f "$tmp"
    die "Não foi possível baixar $url"
  fi
  "$shell" "$tmp"
  rm -f "$tmp"
}

node_major() {
  local v
  v="$(extract_version "$(node --version 2>/dev/null || true)")"
  echo "${v%%.*}"
}

node_lts_major() {
  # Descobre a versão LTS atual na lista oficial do nodejs.org.
  local json line re='"version":"v([0-9]+)\.'
  json="$(curl -fsSL --max-time 20 --proto '=https' https://nodejs.org/dist/index.json)" || return 0
  line="$(printf '%s' "$json" | tr '{' '\n' | grep -m1 '"lts":"' || true)"
  if [[ "$line" =~ $re ]]; then
    echo "${BASH_REMATCH[1]}"
  fi
}

update_shell_profile() {
  # Mantém um bloco próprio no ~/.zprofile para os terminais novos acharem as ferramentas.
  local profile="$HOME/.zprofile" tmp
  [ -n "$PROFILE_LINES" ] || return 0
  touch "$profile"
  tmp="$(mktemp "${TMPDIR:-/tmp}/lume-zprofile.XXXXXX")"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$profile" >"$tmp"
  {
    printf '%s\n' "$MARK_BEGIN"
    printf '%s' "$PROFILE_LINES"
    printf '%s\n' "$MARK_END"
  } >>"$tmp"
  if ! cmp -s "$tmp" "$profile"; then
    cp "$profile" "$profile.bak-lume"
    cat "$tmp" >"$profile"
    info "Atualizei o $profile (cópia de segurança em $profile.bak-lume)."
  fi
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
check_system() {
  step "Verificando o sistema"

  [ "$(uname -s)" = "Darwin" ] || die "Este script é para macOS. No Windows, use o configurar-windows.bat."
  [ "$EUID" -ne 0 ] || die "Não rode com sudo. Use seu usuário normal: o macOS pede a senha quando precisar."

  local version major arch translated free_kb
  version="$(sw_vers -productVersion)"
  major="${version%%.*}"
  if [ "$major" -lt 12 ]; then
    die "macOS $version é antigo demais. É preciso o macOS 12 (Monterey) ou mais novo."
  fi
  arch="$(uname -m)"
  translated="$(sysctl -in sysctl.proc_translated 2>/dev/null || true)"
  if [ "$translated" = "1" ]; then
    die "O Terminal está rodando pelo Rosetta (modo Intel). Desmarque 'Abrir com o Rosetta' nas informações do Terminal e rode de novo."
  fi
  ok "macOS $version ($arch)"
  if [ "$major" -lt 14 ]; then
    warn "macOS $version: o Homebrew pode precisar compilar alguns pacotes (fica mais lento)."
  fi

  free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  case "$free_kb" in
    '' | *[!0-9]*) ;;
    *)
      if [ "$free_kb" -lt $((MIN_FREE_GB * 1024 * 1024)) ]; then
        warn "Pouco espaço livre no disco. Recomendado: ${MIN_FREE_GB} GB ou mais."
      else
        ok "Espaço livre: $((free_kb / 1024 / 1024)) GB"
      fi
      ;;
  esac

  case "$ROOT" in
    *"Mobile Documents"* | *CloudStorage* | *Dropbox* | *"Google Drive"* | *OneDrive*)
      warn "O projeto está numa pasta sincronizada com a nuvem. Funciona, mas a sincronização de .venv e node_modules deixa tudo lento. Prefira algo como ~/Projetos/financas-app."
      ;;
  esac

  if curl -fsS --max-time 20 -o /dev/null https://pypi.org/simple/; then
    ok "Internet ok (pypi.org)"
  else
    die "Sem acesso a https://pypi.org. Verifique a internet, o proxy ou o firewall e rode de novo."
  fi
}

prepare_project_files() {
  # Arquivos de um ZIP baixado ficam em quarentena (Gatekeeper). Libera só este projeto.
  xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null || true
  chmod +x "$ROOT"/*.command "$ROOT"/setup/*.sh "$ROOT"/scripts/*.sh 2>/dev/null || true
}

install_homebrew() {
  step "Homebrew"
  BREW="$(find_brew)"
  if [ -z "$BREW" ] && [ "$NO_TOOLS" -eq 0 ]; then
    info "O Homebrew (gerenciador de pacotes padrão do macOS) não está instalado."
    info "Ele instala Git, Node.js e uv de forma segura e fácil de atualizar. Site oficial: https://brew.sh"
    info "A instalação pede a senha de administrador do Mac e pode levar alguns minutos."
    if confirm "Instalar o Homebrew agora?"; then
      download_and_run "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh" /bin/bash
      BREW="$(find_brew)"
    fi
  fi

  if [ -n "$BREW" ]; then
    eval "$("$BREW" shellenv)"
    PROFILE_LINES="${PROFILE_LINES}eval \"\$($BREW shellenv)\""$'\n'
    ok "$("$BREW" --version 2>/dev/null | awk 'NR==1')"
  else
    warn "Sem Homebrew: o uv vem do instalador oficial; Git e Node.js ficam para instalar depois."
  fi
}

install_git() {
  step "Git"
  if xcode-select -p >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
    ok "$(git --version)"
    return 0
  fi
  if [ -n "$BREW" ] && [ "$NO_TOOLS" -eq 0 ]; then
    brew install git
    ok "$(git --version)"
  else
    warn "Git não encontrado. Ele serve para versionar o código, não para rodar o app. Instale com: xcode-select --install"
  fi
}

install_uv() {
  step "uv (gerenciador do Python)"
  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v uv >/dev/null 2>&1 && [ "$NO_TOOLS" -eq 0 ]; then
    if [ -n "$BREW" ]; then
      brew install uv
    else
      info "Usando o instalador oficial da Astral (https://astral.sh/uv)..."
      download_and_run "https://astral.sh/uv/install.sh" /bin/sh
    fi
  fi
  command -v uv >/dev/null 2>&1 || die "O uv não ficou disponível. Feche o Terminal, abra de novo e rode o script mais uma vez."

  local version
  version="$(extract_version "$(uv --version)")"
  if [ -z "$version" ] || ! version_ge "$version" "$MIN_UV"; then
    info "uv ${version:-desconhecido} é antigo; atualizando..."
    if [ -n "$BREW" ] && brew list uv >/dev/null 2>&1; then
      brew upgrade uv
    else
      uv self update
    fi
    version="$(extract_version "$(uv --version)")"
    if [ -z "$version" ] || ! version_ge "$version" "$MIN_UV"; then
      die "É preciso o uv $MIN_UV ou mais novo."
    fi
  fi
  ok "uv $version"
}

install_node() {
  step "Node.js LTS (para o front-end)"
  local major lts formula node_bin
  major="$(node_major)"
  if [ -n "$major" ] && [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
    ok "Node.js $(node --version), npm $(npm --version)"
    return 0
  fi
  if [ -z "$BREW" ] || [ "$NO_TOOLS" -eq 1 ]; then
    warn "Node.js $MIN_NODE_MAJOR+ não encontrado. Ele só é necessário a partir do passo 2 (front-end). Instale a versão LTS em https://nodejs.org e rode este script de novo."
    return 0
  fi

  lts="$(node_lts_major)"
  formula="node"
  if [ -n "$lts" ] && brew info --formula "node@$lts" >/dev/null 2>&1; then
    formula="node@$lts"
  fi
  info "Instalando $formula pelo Homebrew..."
  brew install "$formula"
  if [ "$formula" != "node" ]; then
    node_bin="$(brew --prefix "$formula")/bin"
    export PATH="$node_bin:$PATH"
    PROFILE_LINES="${PROFILE_LINES}export PATH=\"$node_bin:\$PATH\""$'\n'
  fi

  major="$(node_major)"
  if [ -n "$major" ] && [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
    ok "Node.js $(node --version), npm $(npm --version)"
  else
    warn "Node.js não ficou disponível. Ele só é necessário a partir do passo 2 (front-end)."
  fi
}

install_vscode() {
  [ "$WITH_VSCODE" -eq 1 ] || return 0
  step "Visual Studio Code"
  if [ -d "/Applications/Visual Studio Code.app" ] || command -v code >/dev/null 2>&1; then
    ok "Visual Studio Code já instalado"
  elif [ -n "$BREW" ]; then
    brew install --cask visual-studio-code
    ok "Visual Studio Code instalado"
  else
    warn "Sem Homebrew para instalar o VS Code. Baixe em https://code.visualstudio.com"
  fi
}

setup_backend() {
  step "Python $PYTHON_VERSION (gerenciado pelo uv)"
  uv python install "$PYTHON_VERSION"
  ok "Python em $(uv python find "$PYTHON_VERSION")"

  cd "$BACKEND"
  step "Dependências do back-end"
  info "Conferindo o uv.lock (versões travadas)..."
  uv lock
  uv sync --locked
  ok "Dependências instaladas em backend/.venv"

  step "Banco de dados local e backup"
  uv run --frozen python -m app.cli setup

  if [ "$SKIP_TESTS" -eq 0 ] && [ -d "$BACKEND/tests" ]; then
    step "Testes automáticos"
    uv run --frozen pytest
    ok "Todos os testes passaram"
  fi

  step "Verificação final"
  uv run --frozen python -m app.cli doctor
  cd "$ROOT"
}

setup_frontend() {
  [ -f "$FRONTEND/package.json" ] || return 0
  step "Interface (front-end)"
  local has_dist=0 backup="$FRONTEND/dist.anterior"
  [ -f "$FRONTEND/dist/index.html" ] && has_dist=1
  if ! command -v npm >/dev/null 2>&1; then
    if [ "$has_dist" -eq 1 ]; then
      warn "npm não encontrado: usando a interface já compilada que veio no projeto."
      return 0
    fi
    die "npm não encontrado e não há interface compilada. Instale o Node.js LTS e rode este script de novo."
  fi

  rm -rf "$backup"
  [ "$has_dist" -eq 1 ] && cp -R "$FRONTEND/dist" "$backup"

  cd "$FRONTEND"
  if build_frontend; then
    ok "Interface compilada em frontend/dist"
  else
    if [ "$has_dist" -eq 0 ]; then
      die "Não foi possível compilar o front-end. Veja as mensagens acima."
    fi
    rm -rf "$FRONTEND/dist"
    cp -R "$backup" "$FRONTEND/dist"
    warn "A compilação do front-end falhou. Mantive a interface já compilada que veio no projeto."
  fi
  rm -rf "$backup"
  cd "$ROOT"
}

build_frontend() {
  # Roda num subshell sem o trap de erro, para poder voltar à interface pré-compilada.
  (
    trap - ERR
    set +e
    if [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund || exit 1
    else
      npm install --no-audit --no-fund || exit 1
    fi
    if [ "$SKIP_TESTS" -eq 0 ]; then
      npm run test:unit || exit 1
    fi
    npm run build || exit 1
  )
}

summary() {
  printf '\n%s============================================================%s\n' "$C_GREEN" "$C_RESET"
  printf '%s Ambiente pronto!%s\n' "$C_GREEN" "$C_RESET"
  printf '%s============================================================%s\n' "$C_GREEN" "$C_RESET"
  printf ' Para abrir o app: clique duas vezes em iniciar-macos.command\n'
  printf ' Log desta configuração: %s\n' "$LOG_FILE"
  if [ -n "$WARNINGS" ]; then
    printf '\n%s Avisos:%s\n%s' "$C_YELLOW" "$C_RESET" "$WARNINGS"
  fi
  printf '\n'
}

main() {
  printf '\n%sConfiguração do ambiente (macOS)%s\nProjeto: %s\n' "$C_CYAN" "$C_RESET" "$ROOT"
  check_system
  prepare_project_files
  if [ "$PACKAGE" -eq 1 ]; then
    # Só o uv é necessário: usa o Homebrew se já existir, sem pedir para instalar.
    BREW="$(find_brew)"
    if [ -n "$BREW" ]; then eval "$("$BREW" shellenv)"; fi
    info "Pacote pronto: a interface já vem compilada. Git, Homebrew e Node.js não são necessários."
  else
    install_homebrew
    install_git
  fi
  install_uv
  if [ "$PACKAGE" -eq 0 ]; then install_node; fi
  install_vscode
  setup_frontend
  setup_backend
  update_shell_profile
  summary
}

main
