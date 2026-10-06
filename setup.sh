#!/usr/bin/env bash
set -euo pipefail

# Guided Brepia installer. start.sh remains the runtime launcher.
ROOT_DIR="${BREPIA_SETUP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
MODE=interactive; CHECK_ONLY=0; INSTALL_DEPS=1; MINIMAL=0; YES=0
WITH_LLAMA_CPP=0; WITH_LLAMA_SWAP=0; WITH_OPENCODE=0; WITH_CODEX=0
ENABLE_LLAMA_SWAP_SERVICE=0
BIN_DIR="${BREPIA_BIN_DIR:-${HOME}/.local/bin}"
DATA_DIR="${BREPIA_DATA_DIR:-${XDG_DATA_HOME:-${HOME}/.local/share}/brepia}"
NPM_PREFIX="${BREPIA_NPM_PREFIX:-${DATA_DIR}/npm}"
LLAMA_SWAP_CONFIG_DIR="${BREPIA_LLAMA_SWAP_CONFIG_DIR:-${ROOT_DIR}/.brepia/llama-swap}"
TEST_MODE="${BREPIA_SETUP_TEST_MODE:-0}"; TEST_LOG="${BREPIA_SETUP_TEST_LOG:-}"

usage() {
  cat <<'EOF'
Usage: ./setup.sh [options]

Prepare a Brepia checkout without starting the application.
  --check, --dry-run       Inspect prerequisites and print planned actions only
  --non-interactive, --ci  Never prompt; missing install consent is an error
  --yes                    Allow planned apt/npm/source installs in non-interactive mode
  --minimal                Core Brepia only; skip all optional AI components
  --skip-install           Do not run npm ci
  --with-llama-cpp         Install/build official llama.cpp locally (no model)
  --with-llama-swap        Install official mostlygeek/llama-swap locally
  --with-opencode          Install OpenCode v2 via npm @opencode/cli
  --with-codex             Install Codex CLI via npm @openai/codex
  --enable-llama-swap-service  Install and enable a user systemd unit explicitly
  -h, --help               Show this help

Node is installed from official nodejs.org 22.x release/checksum files when
needed. No secrets, models or passwords are requested, stored or printed.
EOF
}
die() { printf 'setup: %s\n' "$*" >&2; exit 1; }
info() { printf 'setup: %s\n' "$*"; }
log_test() {
  if [[ -n "$TEST_LOG" ]]; then
    printf '%s\n' "$*" >>"$TEST_LOG"
  fi
}
run() { log_test "$*"; [[ "$TEST_MODE" == 1 ]] || "$@"; }

while (($#)); do
  case "$1" in
    --check|--dry-run) CHECK_ONLY=1; shift;;
    --non-interactive|--ci) MODE=non-interactive; shift;;
    --yes) YES=1; shift;;
    --minimal) MINIMAL=1; shift;;
    --skip-install) INSTALL_DEPS=0; shift;;
    --with-llama-cpp) WITH_LLAMA_CPP=1; shift;;
    --with-llama-swap) WITH_LLAMA_SWAP=1; shift;;
    --with-opencode) WITH_OPENCODE=1; shift;;
    --with-codex) WITH_CODEX=1; shift;;
    --enable-llama-swap-service) ENABLE_LLAMA_SWAP_SERVICE=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "unknown option: $1 (use --help)";;
  esac
done
if ((MINIMAL)); then
  WITH_LLAMA_CPP=0; WITH_LLAMA_SWAP=0; WITH_OPENCODE=0; WITH_CODEX=0; ENABLE_LLAMA_SWAP_SERVICE=0
fi

ask_yes_no() {
  local question="$1" answer
  ((YES)) && return 0
  [[ "$MODE" == non-interactive ]] && return 1
  printf 'setup: %s [y/N] ' "$question"; read -r answer
  [[ "$answer" =~ ^[Yy]$ ]]
}
select_optional() {
  ((MINIMAL)) && return
  [[ "$MODE" == interactive ]] || return 0
  local choice
  printf '%s\n' 'setup: Optional components (numbers separated by spaces, Enter for none):'
  printf '%s\n' '  1) llama.cpp   2) llama-swap   3) OpenCode v2   4) Codex CLI'
  read -r choice
  [[ "$choice" == *1* ]] && WITH_LLAMA_CPP=1; [[ "$choice" == *2* ]] && WITH_LLAMA_SWAP=1
  [[ "$choice" == *3* ]] && WITH_OPENCODE=1; [[ "$choice" == *4* ]] && WITH_CODEX=1
}
select_optional

node_version_supported() {
  local actual="$1" major minor
  IFS=. read -r major minor _ <<<"$actual"
  [[ "${major:-0}" =~ ^[0-9]+$ && "${minor:-0}" =~ ^[0-9]+$ ]] || return 1
  (( (major == 20 && minor >= 19) || (major == 22 && minor >= 12) ))
}
have_good_node() {
  command -v node >/dev/null 2>&1 || return 1
  node_version_supported "$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  command -v npm >/dev/null 2>&1 || return 1
  local major; major="$(npm -v 2>/dev/null | cut -d. -f1)"
  [[ "$major" =~ ^[0-9]+$ ]] && ((major >= 10))
}
ensure_node_bootstrap_prerequisites() {
  local missing=() item
  for item in curl python3 tar xz sha256sum; do
    command -v "$item" >/dev/null 2>&1 || missing+=("$item")
  done
  ((${#missing[@]} == 0)) && return
  ((CHECK_ONLY)) && { info "would install Node bootstrap prerequisites with apt: ${missing[*]}"; return; }
  ask_yes_no "Install Node bootstrap prerequisites (${missing[*]}) with apt?" || die 'Node installation prerequisites are required; rerun with --yes or install them manually'
  command -v apt-get >/dev/null || die 'Node installation prerequisites are missing and this installer supports apt on Debian/Ubuntu'
  run sudo apt-get update; run sudo apt-get install -y curl python3 tar xz-utils ca-certificates
}
install_node_local() {
  local arch node_arch index version tarball release_dir
  arch="$(uname -m)"; case "$arch" in x86_64) node_arch=x64;; aarch64|arm64) node_arch=arm64;; *) die "unsupported Node architecture: $arch";; esac
  index="${DATA_DIR}/node-index.json"; version="${BREPIA_NODE_VERSION:-}"
  if [[ -z "$version" ]]; then
    ((CHECK_ONLY)) && { info 'would resolve latest Node 22.x from nodejs.org'; return; }
    command -v curl >/dev/null || die 'curl is required to install user-local Node.js'
    mkdir -p "$DATA_DIR"; curl -fsSL https://nodejs.org/dist/index.json -o "$index"
    version="$(python3 - "$index" <<'PY'
import json,sys
for item in json.load(open(sys.argv[1])):
    if item['version'].startswith('v22.'):
        print(item['version']); break
else: raise SystemExit('no Node 22 release found')
PY
)"
  fi
  tarball="node-${version}-linux-${node_arch}.tar.xz"; release_dir="${DATA_DIR}/node-${version}-linux-${node_arch}"
  ((CHECK_ONLY)) && { info "would checksum-verify and install ${tarball} into ${release_dir}"; return; }
  mkdir -p "$DATA_DIR" "$BIN_DIR"
  curl -fsSL "https://nodejs.org/dist/${version}/${tarball}" -o "${DATA_DIR}/${tarball}"
  curl -fsSL "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o "${DATA_DIR}/SHASUMS256.txt"
  (cd "$DATA_DIR" && grep "  ${tarball}$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$release_dir"; tar -xJf "${DATA_DIR}/${tarball}" -C "$DATA_DIR"
  ln -sfn "${release_dir}/bin/node" "$BIN_DIR/node"; ln -sfn "${release_dir}/bin/npm" "$BIN_DIR/npm"; ln -sfn "${release_dir}/bin/npx" "$BIN_DIR/npx"
  info "installed Node ${version} under ${release_dir}"
}
ensure_node() {
  if have_good_node; then info "Node: $(node -v), npm: $(npm -v)"; return; fi
  if ((CHECK_ONLY)); then
    ensure_node_bootstrap_prerequisites
    info 'Node/npm missing or too old; user-local Node 22.x install planned'
    return
  fi
  ensure_node_bootstrap_prerequisites
  install_node_local; export PATH="$BIN_DIR:$PATH"; have_good_node || die 'Node/npm is still missing or too old after installation'
}
ensure_podman() {
  if command -v podman >/dev/null 2>&1; then info "Podman: $(podman --version 2>/dev/null || printf available)"; return; fi
  ((CHECK_ONLY)) && { info 'Podman missing; would install with apt after consent'; return; }
  ask_yes_no 'Podman is required by local Supabase. Install podman with apt now?' || die 'Podman is required; rerun with --yes or install it manually'
  command -v apt-get >/dev/null || die 'Podman is missing and this installer supports apt on Debian/Ubuntu'
  run sudo apt-get update; run sudo apt-get install -y podman
}
ensure_build_packages() {
  local missing=() item; for item in git cmake make g++; do command -v "$item" >/dev/null 2>&1 || missing+=("$item"); done
  ((${#missing[@]} == 0)) && return
  ((CHECK_ONLY)) && { info "would install llama.cpp prerequisites with apt: ${missing[*]}"; return; }
  ask_yes_no "Install llama.cpp prerequisites (${missing[*]}) with apt?" || die 'build prerequisites are required for llama.cpp'
  run sudo apt-get update; run sudo apt-get install -y git cmake build-essential
}
install_npm_tool() {
  local label="$1" package="$2" command_name="$3"
  ((CHECK_ONLY)) && { info "would install ${package} into user-local npm prefix ${NPM_PREFIX} and link ${BIN_DIR}/${command_name}"; return; }
  run mkdir -p "${NPM_PREFIX}/bin" "$BIN_DIR"
  run npm install --prefix "$NPM_PREFIX" --global "$package"
  run ln -sfn "${NPM_PREFIX}/bin/${command_name}" "${BIN_DIR}/${command_name}"
  [[ "$TEST_MODE" == 1 ]] || [[ -x "${BIN_DIR}/${command_name}" ]] || die "${label} installation did not provide ${command_name}"
  info "installed ${label}; authentication remains manual"
}
detect_llama_backend() {
  local requested="${BREPIA_LLAMA_CPP_BACKEND:-auto}"; [[ "$requested" != auto ]] && { printf '%s' "$requested"; return; }
  command -v nvcc >/dev/null 2>&1 && { printf cuda; return; }; command -v vulkaninfo >/dev/null 2>&1 && { printf vulkan; return; }; printf cpu
}
install_llama_cpp() {
  local source_dir="${BREPIA_LLAMA_CPP_SOURCE_DIR:-${DATA_DIR}/llama.cpp}" backend build_dir server
  if [[ "$TEST_MODE" != 1 ]] && command -v llama-server >/dev/null 2>&1; then info "llama.cpp: $(llama-server --version 2>/dev/null | head -1 || printf 'llama-server available')"; return; fi
  ensure_build_packages; backend="$(detect_llama_backend)"; info "llama.cpp backend: ${backend} (override with BREPIA_LLAMA_CPP_BACKEND=cpu|cuda|vulkan|auto)"; build_dir="${source_dir}/build"
  if ((CHECK_ONLY)); then info "would clone/update https://github.com/ggml-org/llama.cpp at ${source_dir}"; info "would build llama-server and link it into ${BIN_DIR} (no model download)"; return; fi
  mkdir -p "$DATA_DIR" "$BIN_DIR"
  if [[ -d "$source_dir/.git" ]]; then run git -C "$source_dir" pull --ff-only; else run git clone https://github.com/ggml-org/llama.cpp "$source_dir"; fi
  local flags=(-DCMAKE_BUILD_TYPE=Release); [[ "$backend" == cuda ]] && flags+=(-DGGML_CUDA=ON); [[ "$backend" == vulkan ]] && flags+=(-DGGML_VULKAN=ON)
  run cmake -S "$source_dir" -B "$build_dir" "${flags[@]}"; run cmake --build "$build_dir" --config Release --target llama-server -j "${BREPIA_BUILD_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 2)}"
  server="$(find "$build_dir" -type f -name llama-server -perm -111 -print -quit)"; [[ -n "$server" ]] || die 'llama.cpp build did not produce llama-server'; ln -sfn "$server" "$BIN_DIR/llama-server"; info "llama-server installed at ${BIN_DIR}/llama-server; no model downloaded"
}
install_llama_swap() {
  local arch asset api='https://api.github.com/repos/mostlygeek/llama-swap/releases/latest'
  if [[ "$TEST_MODE" != 1 ]] && command -v llama-swap >/dev/null 2>&1; then info "llama-swap: $(llama-swap -version 2>/dev/null | head -1 || printf available)"; else
    arch="$(uname -m)"; case "$arch" in x86_64) arch=amd64;; aarch64|arm64) arch=arm64;; *) die "unsupported llama-swap architecture: $arch";; esac
    asset="llama-swap_VERSION_linux_${arch}.tar.gz"
    if ((CHECK_ONLY)); then info "would resolve latest mostlygeek/llama-swap Linux ${arch} release into ${BIN_DIR}"; elif [[ "$TEST_MODE" == 1 ]]; then
      log_test "download mostlygeek/llama-swap latest llama-swap_VERSION_linux_${arch}.tar.gz; install ${BIN_DIR}/llama-swap"
    else
      command -v curl >/dev/null || die 'curl is required for llama-swap'; local url name
      name="$(curl -fsSL "$api" | python3 -c 'import json,sys; a="'$arch'"; print(next(x["name"] for x in json.load(sys.stdin)["assets"] if x["name"].endswith("_linux_"+a+".tar.gz")))')"; url="https://github.com/mostlygeek/llama-swap/releases/latest/download/${name}"
      mkdir -p "$BIN_DIR" "${DATA_DIR}/downloads"; curl -fsSL "$url" -o "${DATA_DIR}/downloads/${name}"; tar -xzf "${DATA_DIR}/downloads/${name}" -C "$BIN_DIR" llama-swap; chmod 755 "$BIN_DIR/llama-swap"; info "installed llama-swap into ${BIN_DIR}"
    fi
  fi
  if [[ ! -e "$LLAMA_SWAP_CONFIG_DIR/config.yaml" ]]; then
    if ((CHECK_ONLY)); then info "would create llama-swap skeleton at ${LLAMA_SWAP_CONFIG_DIR}/config.yaml"; else
      mkdir -p "$LLAMA_SWAP_CONFIG_DIR"
      cat >"$LLAMA_SWAP_CONFIG_DIR/config.yaml" <<EOF
# Brepia local llama-swap configuration. No model is downloaded or enabled.
models: {}
# Uncomment after supplying a model; llama-swap assigns the backend port:
# models:
#   brepia-example:
#     cmd: ${BIN_DIR}/llama-server --model /path/to/model.gguf --host 127.0.0.1 --port \${PORT}
EOF
      info "created disabled llama-swap skeleton at ${LLAMA_SWAP_CONFIG_DIR}/config.yaml"
    fi
  else info 'existing llama-swap config preserved'; fi
}
enable_llama_swap_service() {
  ((WITH_LLAMA_SWAP)) || die '--enable-llama-swap-service requires --with-llama-swap'
  local unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
  local unit="${unit_dir}/brepia-llama-swap.service"
  ((CHECK_ONLY)) && { info 'would install and enable a user llama-swap systemd service'; return; }; mkdir -p "$unit_dir"
  cat >"$unit" <<EOF
[Unit]
Description=Brepia local llama-swap (optional)
After=network.target
[Service]
ExecStart=${BIN_DIR}/llama-swap -config ${LLAMA_SWAP_CONFIG_DIR}/config.yaml -listen 127.0.0.1:8080
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  run systemctl --user daemon-reload; run systemctl --user enable --now brepia-llama-swap.service; info 'enabled user llama-swap service (explicit request)'
}

ensure_node; ensure_podman
if [[ ! -f "$ROOT_DIR/.env.local" ]]; then
  [[ -f "$ROOT_DIR/.env.local.template" ]] || die '.env.local.template is missing'
  if ((CHECK_ONLY)); then info 'would create .env.local from .env.local.template'; else umask 077; cp "$ROOT_DIR/.env.local.template" "$ROOT_DIR/.env.local"; info 'created .env.local from the template (no secrets were generated)'; fi
else info 'existing .env.local preserved'; fi
if ((INSTALL_DEPS)); then if ((CHECK_ONLY)); then info 'would run npm ci'; else (cd "$ROOT_DIR" && run npm ci); fi; fi
((WITH_LLAMA_CPP)) && install_llama_cpp; ((WITH_LLAMA_SWAP)) && install_llama_swap
((WITH_OPENCODE)) && install_npm_tool 'OpenCode v2 CLI' '@opencode/cli' opencode
((WITH_CODEX)) && install_npm_tool 'Codex CLI' '@openai/codex' codex
((ENABLE_LLAMA_SWAP_SERVICE)) && enable_llama_swap_service
if ((WITH_LLAMA_SWAP && !ENABLE_LLAMA_SWAP_SERVICE)); then
  info "manual start: ${BIN_DIR}/llama-swap -config ${LLAMA_SWAP_CONFIG_DIR}/config.yaml -listen 127.0.0.1:8080"
fi
if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then info "PATH hint: export PATH=\"${BIN_DIR}:\$PATH\""; fi
info 'setup complete; start Brepia with ./start.sh'
