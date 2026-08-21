#!/usr/bin/env bash
# Verbbe CLI — no Node required. Install:
#   curl -fsSL https://verbbe.com/install.sh | bash
# Then:
#   verbbe start --music ~/Music
set -euo pipefail

VERSION="1.0.0"
IMAGE="ghcr.io/bg-isma/verbbe:latest"
GIT_BUILD="https://github.com/bg-isma/Verbbe.git#main:server"
DEFAULT_PORT=4747
PREFIX="${VERBBE_PREFIX:-$HOME/.verbbe}"
if [[ ! -d "$PREFIX" && -d "$HOME/.nookplay" ]]; then
  mv "$HOME/.nookplay" "$PREFIX"
fi
BIN="$PREFIX/bin"
ENV_FILE="$PREFIX/env"
COMPOSE_FILE="$PREFIX/compose.yml"
INSTALL_URLS=(
  "${VERBBE_CLI_URL:-}"
  "https://verbbe.com/install.sh"
  "https://raw.githubusercontent.com/bg-isma/Verbbe/main/cli/verbbe.sh"
)

lime=$'\033[38;2;79;255;111m'
dim=$'\033[38;2;160;160;165m'
red=$'\033[38;2;255;79;82m'
bold=$'\033[1m'
reset=$'\033[0m'

say() { printf '%s\n' "$*"; }
note() { printf '%s\n' "$*" >&2; }
fail() { printf '%s%s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

music_default() {
  for d in "$HOME/Music" "$HOME/Música" "$HOME/My Music"; do
    [[ -d "$d" ]] && { printf '%s' "$d"; return; }
  done
  printf '%s' "$HOME/Music"
}

read_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

write_env() {
  mkdir -p "$PREFIX"
  umask 077
  cat >"$ENV_FILE" <<EOF
VERBBE_MUSIC="${VERBBE_MUSIC}"
VERBBE_PORT="${VERBBE_PORT:-$DEFAULT_PORT}"
VERBBE_NAME="${VERBBE_NAME:-Verbbe}"
VERBBE_MODE="${VERBBE_MODE:-lan}"
VERBBE_FUNNEL="${VERBBE_FUNNEL:-0}"
VERBBE_FUNNEL_PUBLIC="${VERBBE_FUNNEL_PUBLIC:-0}"
VERBBE_TRUST_PROXY="${VERBBE_TRUST_PROXY:-0}"
EOF
}

write_compose() {
  mkdir -p "$PREFIX"
  cat >"$COMPOSE_FILE" <<EOF
name: verbbe
services:
  verbbe:
    container_name: verbbe
    image: ${IMAGE}
    build:
      context: ${GIT_BUILD}
    ports:
      - "\${VERBBE_PORT:-4747}:4747"
    environment:
      DATA_DIR: /data
      MUSIC_DIR: /music
      SERVER_NAME: \${VERBBE_NAME:-Verbbe}
      TRUST_PROXY: \${VERBBE_TRUST_PROXY:-0}
    volumes:
      - verbbe-data:/data
      - \${VERBBE_MUSIC}:/music:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4747/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
volumes:
  verbbe-data:
EOF
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

docker_ready() {
  docker info >/dev/null 2>&1 && { docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1; }
}

ensure_docker() {
  if docker_ready; then return 0; fi
  if command -v docker >/dev/null 2>&1; then
    note "${dim}  Docker is installed — opening it…${reset}"
    if [[ "$(uname -s)" == "Darwin" ]]; then
      open -a Docker >/dev/null 2>&1 || open -a "Docker Desktop" >/dev/null 2>&1 || true
    fi
  else
    note "${dim}  Docker is missing — installing it…${reset}"
    case "$(uname -s)" in
      Darwin)
        command -v brew >/dev/null 2>&1 || fail "Install Homebrew from https://brew.sh then re-run."
        brew install --cask docker-desktop >/dev/null 2>&1 || brew install --cask docker || fail "Could not install Docker. See https://docs.docker.com/get-docker/"
        open -a Docker >/dev/null 2>&1 || open -a "Docker Desktop" >/dev/null 2>&1 || true
        ;;
      Linux)
        curl -fsSL https://get.docker.com | sh
        if command -v sudo >/dev/null 2>&1 && [[ -n "${USER:-}" ]]; then
          sudo usermod -aG docker "$USER" >/dev/null 2>&1 || true
        fi
        ;;
      *)
        fail "Install Docker from https://docs.docker.com/get-docker/ and re-run."
        ;;
    esac
  fi
  note "${dim}  Waiting for Docker to start…${reset}"
  local i
  for i in $(seq 1 90); do
    docker_ready && return 0
    sleep 2
  done
  fail "Open Docker Desktop, finish the first-run screens, then re-run."
}

lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  elif command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

ts_bin() {
  local c
  for c in \
    /Applications/Tailscale.app/Contents/MacOS/Tailscale \
    /Applications/Tailscale.app/Contents/MacOS/tailscale \
    /opt/homebrew/bin/tailscale \
    /usr/local/bin/tailscale
  do
    [[ -x "$c" ]] && { printf '%s' "$c"; return; }
  done
  command -v tailscale 2>/dev/null || true
}

ts_dns() {
  local bin
  bin="$(ts_bin)"
  [[ -n "$bin" ]] || return 0
  "$bin" status --json 2>/dev/null | python3 -c "import json,sys
try:
 d=json.load(sys.stdin); n=(d.get('Self') or {}).get('DNSName') or ''
 print(n.rstrip('.'))
except Exception:
 pass" 2>/dev/null || true
}

public_away_ok() {
  local host="$1"
  [[ -n "$host" ]] || return 1
  local json ip
  json="$(curl -fsS -m 8 "https://dns.google/resolve?name=${host}&type=A" 2>/dev/null || true)"
  ip="$(printf '%s' "$json" | python3 -c "import json,sys
d=json.load(sys.stdin)
for a in d.get('Answer') or []:
  if int(a.get('type') or 0)==1:
    ip=a.get('data') or ''
    p=ip.split('.')
    if p and p[0] not in ('100','10','127','169'):
      print(ip); break
" 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(printf '%s' "$json" | grep -oE '"data": "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' || true)"
  fi
  [[ -n "$ip" ]] || return 1
  curl -fsS -m 12 --resolve "${host}:443:${ip}" "https://${host}/api/server-info" 2>/dev/null | grep -q hasAdmin
}

ensure_tailscale() {
  local bin
  bin="$(ts_bin)"
  if [[ -z "$bin" ]]; then
    note "${dim}  Installing Tailscale…${reset}"
    case "$(uname -s)" in
      Darwin)
        command -v brew >/dev/null 2>&1 || fail "Install Tailscale from https://tailscale.com/download"
        brew install --cask tailscale-app || brew install --cask tailscale
        open -a Tailscale >/dev/null 2>&1 || true
        ;;
      Linux)
        curl -fsSL https://tailscale.com/install.sh | sh
        ;;
      *)
        fail "Install Tailscale from https://tailscale.com/download"
        ;;
    esac
    sleep 3
    bin="$(ts_bin)"
  fi
  [[ -n "$bin" ]] || fail "Tailscale CLI not found."
  if ! "$bin" ip -4 >/dev/null 2>&1; then
    note "${dim}  A browser may open — sign in to Tailscale, then come back.${reset}"
    "$bin" up || fail "Could not connect Tailscale."
  fi
}

enable_funnel() {
  local port="$1"
  local bin
  bin="$(ts_bin)"
  [[ -n "$bin" ]] || fail "Tailscale CLI not found."
  note "${dim}  Enabling public HTTPS (other devices only need Verbbe)…${reset}"
  "$bin" funnel --bg --yes "$port" >/dev/null 2>&1 || "$bin" funnel --bg "$port" || true
  local i host
  for i in $(seq 1 36); do
    host="$(ts_dns)"
    if [[ -n "$host" ]] && public_away_ok "$host"; then
      VERBBE_FUNNEL=1
      VERBBE_FUNNEL_PUBLIC=1
      VERBBE_TRUST_PROXY=1
      note "${lime}  ●${reset}  Away is public  ${dim}https://${host}${reset}"
      return 0
    fi
    note "${dim}  Waiting until Away works without Tailscale on the phone…${reset}"
    sleep 5
  done
  note ""
  note "  Enable HTTPS Certificates once: https://login.tailscale.com/admin/dns"
  note "  Then re-run: verbbe start --mode tailscale"
  if [[ -t 0 ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then open "https://login.tailscale.com/admin/dns"; fi
    note "  Press Enter after enabling HTTPS / Funnel…"
    read -r _
    "$bin" funnel --bg --yes "$port" >/dev/null 2>&1 || true
    for i in $(seq 1 36); do
      host="$(ts_dns)"
      if [[ -n "$host" ]] && public_away_ok "$host"; then
        VERBBE_FUNNEL=1
        VERBBE_FUNNEL_PUBLIC=1
        VERBBE_TRUST_PROXY=1
        note "${lime}  ●${reset}  Away is public  ${dim}https://${host}${reset}"
        return 0
      fi
      sleep 5
    done
  fi
  fail "Away is not on the public internet yet. Phones without Tailscale cannot connect."
}

reset_funnel() {
  local bin
  bin="$(ts_bin)"
  [[ -n "$bin" ]] || return 0
  "$bin" funnel reset >/dev/null 2>&1 || true
  "$bin" serve reset >/dev/null 2>&1 || true
}

print_urls() {
  local port="${VERBBE_PORT:-$DEFAULT_PORT}"
  local ip
  ip="$(lan_ip)"
  say "  ${dim}Local${reset}    http://127.0.0.1:${port}"
  if [[ -n "$ip" ]]; then
    say "  ${dim}Home${reset}     ${lime}${bold}http://${ip}:${port}${reset}"
  fi
  if [[ "${VERBBE_MODE:-lan}" == "tailscale" ]]; then
    local host
    host="$(ts_dns)"
    if [[ -n "$host" ]] && public_away_ok "$host"; then
      say "  ${dim}Away${reset}     ${lime}${bold}https://${host}${reset}"
      say ""
      say "  ${dim}On this Wi-Fi paste Home. Anywhere else paste Away. No Tailscale on the phone.${reset}"
    else
      say "  ${dim}Away${reset}     ${red}not on the public internet yet${reset}"
    fi
  fi
  say ""
  say "  ${dim}1.${reset} Open Local. The first account is admin."
  say "  ${dim}2.${reset} Scan your music."
  say "  ${dim}3.${reset} In Verbbe: Profile → Server → paste Home or Away."
}

usage() {
  cat <<EOF
${bold}verbbe${reset} — your music, on your computer

  start     [--music PATH] [--mode lan|tailscale] [--port 4747] [--yes]
  stop      turn the server off (music files stay)
  uninstall [--yes] [--keep-data]
  restart
  status
  url
  logs      [-f]
  open
  help

  curl -fsSL https://verbbe.com/install.sh | bash
  verbbe start --music ~/Music

Docker is installed for you if missing. Node is not required.
EOF
}

ensure_path() {
  export PATH="$BIN:$PATH"
  local rc="$HOME/.zshrc"
  case "${SHELL:-}" in
    */bash) rc="$HOME/.bashrc" ;;
  esac
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  if grep -Fq '.verbbe/bin' "$rc" 2>/dev/null; then
    return 0
  fi
  printf '\n# Verbbe\nexport PATH="%s:$PATH"\n' "$BIN" >>"$rc"
  say "  ${dim}Added to PATH in ${rc}${reset}"
  say "  ${dim}Open a new Terminal, or run: source ${rc}${reset}"
}

self_install() {
  mkdir -p "$BIN"
  local src="${BASH_SOURCE[0]:-}"
  # Piped `curl | bash` has no real source file — download instead of copying bash itself.
  if [[ -n "$src" && -f "$src" && "$src" != /bin/bash && "$src" != /usr/bin/bash && "$(basename -- "$src")" != bash ]]; then
    cp "$src" "$BIN/verbbe"
  else
    local url ok=""
    for url in "${INSTALL_URLS[@]}"; do
      [[ -z "$url" ]] && continue
      if curl -fsSL "$url" -o "$BIN/verbbe"; then
        ok="$url"
        break
      fi
    done
    [[ -n "$ok" ]] || fail "Could not download the Verbbe CLI."
  fi
  chmod +x "$BIN/verbbe"
  say ""
  say "  ${lime}verbbe${reset}  installed"
  say "  ${dim}$BIN/verbbe${reset}"
  say ""
  ensure_path
  say "  Then:"
  say "    verbbe start --music ~/Music"
  say "    verbbe stop          # turn it off"
  say "    verbbe uninstall     # remove the service"
  say ""
}

cmd_start() {
  local music="" mode="" port="$DEFAULT_PORT" yes=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --music|-m) music="$2"; shift 2 ;;
      --mode) mode="$2"; shift 2 ;;
      --port|-p) port="$2"; shift 2 ;;
      --yes|-y) yes=1; shift ;;
      --name) VERBBE_NAME="$2"; shift 2 ;;
      *) fail "Unknown flag: $1" ;;
    esac
  done
  read_env
  music="${music:-${VERBBE_MUSIC:-$(music_default)}}"
  music="${music/#\~/$HOME}"
  [[ -d "$music" ]] || fail "Music folder not found: $music"
  if [[ -z "$mode" ]]; then
    mode="${VERBBE_MODE:-}"
    if [[ -z "$mode" ]]; then
      if [[ "$yes" -eq 1 || ! -t 0 ]]; then
        mode="lan"
      else
        note ""
        note "Where should the phone reach this computer?"
        note "  1) Home Wi-Fi only"
        note "  2) From anywhere (Tailscale on this computer only; phone uses Verbbe)"
        note ""
        local answer=""
        read -r -p "Choose [1/2]: " answer
        case "$answer" in
          2|tailscale|fuera|anywhere) mode="tailscale" ;;
          *) mode="lan" ;;
        esac
      fi
    fi
  fi
  case "$mode" in
    lan|local|home|casa) mode="lan" ;;
    tailscale|remote|funnel|anywhere|fuera) mode="tailscale" ;;
    *) fail "Use --mode lan or --mode tailscale" ;;
  esac

  VERBBE_MUSIC="$music"
  VERBBE_PORT="$port"
  VERBBE_NAME="${VERBBE_NAME:-Verbbe}"
  VERBBE_MODE="$mode"
  VERBBE_FUNNEL=0
  VERBBE_FUNNEL_PUBLIC=0
  VERBBE_TRUST_PROXY=0

  say ""
  say "  ${lime}${bold}verbbe${reset}  ${dim}${VERSION}${reset}"
  say ""
  say "  ${dim}music${reset}   $music"
  say "  ${dim}port${reset}    $port"
  say "  ${dim}mode${reset}    $mode"
  say ""

  if [[ "$mode" == "lan" ]]; then reset_funnel; fi
  ensure_docker
  if [[ "$mode" == "tailscale" ]]; then
    ensure_tailscale
  fi
  write_env
  write_compose
  note "${dim}  Starting the container…${reset}"
  compose up -d --build
  if [[ "$mode" == "tailscale" ]]; then
    enable_funnel "$port"
    write_env
  fi
  say ""
  print_urls
  if [[ "$(uname -s)" == "Darwin" ]]; then open "http://127.0.0.1:${port}" >/dev/null 2>&1 || true; fi
}

cmd_stop() {
  read_env
  if [[ "${VERBBE_FUNNEL:-0}" == "1" || "${VERBBE_MODE:-}" == "tailscale" ]]; then
    note "${dim}  Turning off the public Away link…${reset}"
    reset_funnel
    VERBBE_FUNNEL=0
    VERBBE_FUNNEL_PUBLIC=0
    VERBBE_TRUST_PROXY=0
    write_env
  fi
  if [[ -f "$COMPOSE_FILE" ]] && docker_ready; then
    compose down || true
  else
    docker rm -f verbbe >/dev/null 2>&1 || true
  fi
  say "${lime}  stopped${reset}"
  say "${dim}  Your music files are still on disk. Start again with: verbbe start${reset}"
}

cmd_uninstall() {
  local yes=0 keep=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes|-y) yes=1; shift ;;
      --keep-data) keep=1; shift ;;
      *) fail "Unknown flag: $1" ;;
    esac
  done
  read_env
  note ""
  note "  This removes the Verbbe server from this computer."
  note "  Your music folder is never deleted."
  note ""
  if [[ "$yes" -eq 0 && -t 0 && "$keep" -eq 0 ]]; then
    local wipe_ans=""
    read -r -p "Also delete the server library (users, playlists)? [y/N] " wipe_ans
    if [[ ! "$wipe_ans" =~ ^[yY] ]]; then keep=1; fi
    local ok=""
    read -r -p "Uninstall Verbbe on this computer? [y/N] " ok
    if [[ ! "$ok" =~ ^[yY] ]]; then say "${dim}  cancelled${reset}"; return 0; fi
  fi
  reset_funnel
  if [[ -f "$COMPOSE_FILE" ]] && docker_ready; then
    if [[ "$keep" -eq 1 ]]; then compose down || true
    else compose down -v || true
    fi
  else
    docker rm -f verbbe >/dev/null 2>&1 || true
    [[ "$keep" -eq 0 ]] && docker volume rm -f verbbe_verbbe-data >/dev/null 2>&1 || true
  fi
  rm -f "$COMPOSE_FILE"
  if [[ "$keep" -eq 0 ]]; then
    rm -f "$ENV_FILE"
    rm -rf "$PREFIX/data"
  fi
  say "${lime}  uninstalled${reset}"
  if [[ "$keep" -eq 0 ]]; then
    say "${dim}  Server data removed. Music files on your disk were not touched.${reset}"
  else
    say "${dim}  Container removed. Server library kept.${reset}"
  fi
}

cmd_url() {
  read_env
  print_urls
}

cmd_status() {
  read_env
  if [[ -f "$COMPOSE_FILE" ]] && docker_ready; then
    compose ps || true
    say ""
  fi
  print_urls
}

cmd_logs() {
  read_env
  [[ -f "$COMPOSE_FILE" ]] || fail "Server is not running. Try: verbbe start"
  ensure_docker
  if [[ "${1:-}" == "-f" || "${1:-}" == "--follow" ]]; then
    compose logs -f
  else
    compose logs --tail 200
  fi
}

cmd_open() {
  read_env
  local port="${VERBBE_PORT:-$DEFAULT_PORT}"
  if [[ "$(uname -s)" == "Darwin" ]]; then open "http://127.0.0.1:${port}"
  else xdg-open "http://127.0.0.1:${port}" >/dev/null 2>&1 || true
  fi
}

# Piped from curl, or first-time copy into ~/.verbbe/bin
if [[ "$(basename -- "$0")" != "verbbe" ]]; then
  self_install
  if [[ $# -gt 0 && "${1:-}" != "install" ]]; then
    exec "$BIN/verbbe" "$@"
  fi
  exit 0
fi

cmd="${1:-help}"
shift || true
case "$cmd" in
  start) cmd_start "$@" ;;
  stop|off) cmd_stop "$@" ;;
  uninstall|remove) cmd_uninstall "$@" ;;
  restart) cmd_stop; cmd_start "$@" ;;
  status) cmd_status "$@" ;;
  url) cmd_url "$@" ;;
  logs) cmd_logs "$@" ;;
  open) cmd_open "$@" ;;
  install) self_install ;;
  help|-h|--help) usage ;;
  version|-v|--version) say "$VERSION" ;;
  *) fail "Unknown command: $cmd"$'\n'"Run verbbe help" ;;
esac
