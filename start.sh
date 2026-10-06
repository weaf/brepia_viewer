#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Hydrate checkout-local Supabase host ports before any CLI command reads config.toml.
source "${SCRIPT_DIR}/scripts/supabase-local.sh"

# Supabase Studio expects this bind-mount source even in a clean public clone.
# Keep generated/public checkouts self-starting without tracked local data.
mkdir -p "${SCRIPT_DIR}/supabase/snippets"

# Raise file descriptor limit (Vite watcher needs it in explicit HMR mode)
ulimit -n 65536 2>/dev/null || true

# Warn if inotify instance limit is too low (Vite watch + podman containers)
INOTIFY_MAX="$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || echo 0)"
if [ "${INOTIFY_MAX}" -lt 512 ]; then
  echo "WARNING: fs.inotify.max_user_instances=${INOTIFY_MAX} (<512) may break the Vite watcher. Set it as root:"
  echo "  sudo sysctl fs.inotify.max_user_instances=512"
fi

echo "=== Starting Podman socket ==="
export DOCKER_HOST="unix:///run/user/$(id -u)/podman/podman.sock"
PODMAN_SOCKET_PATH="/run/user/$(id -u)/podman/podman.sock"
PODMAN_SOCKET_LOG="/tmp/brepia-podman-socket-$(id -u).log"
if [ -S "${PODMAN_SOCKET_PATH}" ]; then
  echo "Podman socket: already available"
else
  systemctl --user enable podman.socket --now 2>/dev/null || true
fi
if [ ! -S "${PODMAN_SOCKET_PATH}" ]; then
  echo "Podman socket: user service unavailable; starting a user-scoped socket fallback"
  mkdir -p "$(dirname "${PODMAN_SOCKET_PATH}")"
  podman system service --time=0 "${DOCKER_HOST}" >"${PODMAN_SOCKET_LOG}" 2>&1 &
  PODMAN_SOCKET_PID=$!
  for _ in $(seq 1 20); do
    [ -S "${PODMAN_SOCKET_PATH}" ] && break
    if ! kill -0 "${PODMAN_SOCKET_PID}" 2>/dev/null; then
      echo "Podman socket fallback failed; log: ${PODMAN_SOCKET_LOG}" >&2
      tail -n 20 "${PODMAN_SOCKET_LOG}" >&2 || true
      exit 1
    fi
    sleep 1
  done
fi
[ -S "${PODMAN_SOCKET_PATH}" ] || { echo "Podman socket unavailable: ${PODMAN_SOCKET_PATH}" >&2; exit 1; }
echo "DOCKER_HOST=$DOCKER_HOST"

# The canonical local launcher owns the native BRep evaluator configuration.
# Keep an operator-supplied runner authoritative; otherwise use the repository
# sandbox with an absolute path so both Vite/HMR and the stable preview child
# inherit the same native evaluator configuration.
if [ -z "${BREPIA_BREP_RUNNER:-}" ]; then
  export BREPIA_BREP_RUNNER="${SCRIPT_DIR}/scripts/brep/brepia-brep-sandbox"
fi
echo "BRep runner: configured"

# podman <5 cannot parse {{.Label "key"}} in ps --format templates, which the
# Supabase CLI relies on to find project containers. Prepend a shim for local
# lifecycle, status and credential reads through the repository-local CLI.
export PATH="${SCRIPT_DIR}/scripts/podman:${PATH}"

echo "=== Checking Supabase ==="
brepia_ensure_supabase_ports
if [ "${BREPIA_SUPABASE_PORT_LAYOUT_CREATED:-0}" = "1" ]; then
  brepia_migrate_legacy_port_layout
fi
if brepia_supabase status > /dev/null 2>&1 && brepia_supabase_api_ready; then
  echo "Supabase: up"
else
  if brepia_supabase status > /dev/null 2>&1; then
    echo "Supabase: stale or unhealthy local stack detected - restarting"
    brepia_supabase_cli stop > /dev/null 2>&1 || true
    brepia_remove_stale_project_containers
  else
    echo "Supabase: local stack is not running - starting on checkout-local ports"
  fi

  # Podman 4.9 can leave a freshly recovered PostgreSQL container in the
  # health-check "starting" state even after pg_isready succeeds. Kick its
  # healthcheck once while the repository-local CLI is waiting, then enforce
  # the application-level Auth/API readiness check below. Keep CLI output out
  # of the launcher log because status errors can contain local credentials.
  SUPABASE_START_LOG="$(mktemp "${TMPDIR:-/tmp}/brepia-supabase-start.XXXXXX")"
  brepia_supabase start --ignore-health-check >"${SUPABASE_START_LOG}" 2>&1 &
  SUPABASE_START_PID=$!
  for _ in $(seq 1 120); do
    brepia_refresh_supabase_healthchecks
    if ! kill -0 "${SUPABASE_START_PID}" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if ! wait "${SUPABASE_START_PID}"; then
    rm -f "${SUPABASE_START_LOG}"
    echo "Supabase: ERROR - local start failed"
    exit 1
  fi
  rm -f "${SUPABASE_START_LOG}"
  SUPABASE_READY=0
  for _ in $(seq 1 60); do
    brepia_refresh_supabase_healthchecks
    if brepia_supabase status > /dev/null 2>&1 && brepia_supabase_api_ready; then
      SUPABASE_READY=1
      break
    fi
    sleep 1
  done
  if [ "${SUPABASE_READY}" -ne 1 ]; then
    echo "Supabase: ERROR - local stack did not become healthy after start"
    exit 1
  fi
  echo "Supabase: up (checkout-local ports)"
fi

# Make the running local Supabase credentials available to the TanStack/Vite
# server process. Recent Supabase CLI pretty output shows publishable/secret
# keys, while `status -o env` still provides the legacy ANON_KEY and
# SERVICE_ROLE_KEY names used by this app. Never print these values here.
SUPABASE_STATUS_ENV="$(brepia_supabase_status_env 2>/dev/null || true)"
supabase_env_value() {
  printf '%s\n' "${SUPABASE_STATUS_ENV}" | awk -F= -v wanted="$1" '
    $1 == wanted {
      sub(/^[^=]*=/, "")
      gsub(/^"|"$/, "")
      print
      exit
    }
  '
}

if [ -z "${VITE_SUPABASE_URL:-}" ]; then
  SUPABASE_API_URL="$(supabase_env_value API_URL)"
  if [ -n "${SUPABASE_API_URL}" ]; then
    export VITE_SUPABASE_URL="${SUPABASE_API_URL}"
  fi
fi

if [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  SUPABASE_ANON_KEY="$(supabase_env_value ANON_KEY)"
  if [ -n "${SUPABASE_ANON_KEY}" ]; then
    export VITE_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}"
  fi
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  LOCAL_SERVICE_ROLE_KEY="$(supabase_env_value SERVICE_ROLE_KEY)"
  if [ -n "${LOCAL_SERVICE_ROLE_KEY}" ]; then
    export SUPABASE_SERVICE_ROLE_KEY="${LOCAL_SERVICE_ROLE_KEY}"
  fi
fi

# Read one server-only value from Vite development env files without broadly
# exporting every .env entry into the shell. This keeps the earlier narrow env
# behavior while allowing persistent provider credentials to work locally.
vite_env_value() {
  node --input-type=module - "$1" <<'NODE'
import { loadEnv } from 'vite';
const key = process.argv[2];
const values = loadEnv('development', process.cwd(), '');
process.stdout.write(values[key] ?? '');
NODE
}

if [ -z "${BREPIA_CREDENTIAL_ENCRYPTION_KEY:-}" ]; then
  value="$(vite_env_value BREPIA_CREDENTIAL_ENCRYPTION_KEY)"
  if [ -n "${value}" ]; then
    export BREPIA_CREDENTIAL_ENCRYPTION_KEY="${value}"
  fi
fi

# Provider credentials are encrypted at rest. For local development, create a
# persistent 256-bit key if the operator did not supply one. The *.local file
# is gitignored and mode 600; the key is never printed.
if [ -z "${BREPIA_CREDENTIAL_ENCRYPTION_KEY:-}" ]; then
  BREPIA_LOCAL_KEY_FILE="${SCRIPT_DIR}/.brepia-credential-key.local"
  if [ ! -s "${BREPIA_LOCAL_KEY_FILE}" ]; then
    umask 077
    node --input-type=module <<'NODE' > "${BREPIA_LOCAL_KEY_FILE}"
import crypto from 'node:crypto';
process.stdout.write(crypto.randomBytes(32).toString('hex'));
NODE
    chmod 600 "${BREPIA_LOCAL_KEY_FILE}" 2>/dev/null || true
  fi
  BREPIA_CREDENTIAL_ENCRYPTION_KEY="$(cat "${BREPIA_LOCAL_KEY_FILE}")"
  export BREPIA_CREDENTIAL_ENCRYPTION_KEY
  echo "Provider credential encryption: local key ready"
else
  echo "Provider credential encryption: configured"
fi
unset value

echo "=== Starting OpenCode server ==="
# OpenCode server configuration:
#   OPENCODE_BASE_URL        - use an explicitly configured external server;
#                              Brepia will not start its own OpenCode process.
#   OPENCODE_PORT            - optional fixed port for Brepia's managed server.
#                              When unset, Brepia chooses a free loopback port.
#   OPENCODE_SERVER_PASSWORD - optional HTTP Basic Auth password.
#   OPENCODE_SERVER_USERNAME - optional Basic Auth username (default: opencode).
#
# Load ONLY OpenCode connection settings from Vite development env files so
# Brepia and a managed OpenCode server inherit the same explicit configuration.
for key in OPENCODE_BASE_URL OPENCODE_PORT OPENCODE_SERVER_USERNAME OPENCODE_SERVER_PASSWORD; do
  if [ -z "${!key-}" ]; then
    value="$(vite_env_value "$key")"
    if [ -n "${value}" ]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  fi
done
unset key value

OPENCODE_HOST="127.0.0.1"
OPENCODE_CHILD_PID=""
OPENCODE_LOG=""

# Ask the OS for an available loopback port. The tiny race between releasing
# the probe socket and starting a child process is handled by checking whether
# that child survives and becomes healthy; an explicit port instead fails loudly.
choose_free_port() {
  node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.unref();
server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
}

STABLE_ARTIFACT_DIR=""

cleanup_opencode() {
  if [ -n "${OPENCODE_CHILD_PID:-}" ] && kill -0 "${OPENCODE_CHILD_PID}" 2>/dev/null; then
    echo "Stopping Brepia OpenCode server (pid ${OPENCODE_CHILD_PID})..."
    kill "${OPENCODE_CHILD_PID}" 2>/dev/null || true
    wait "${OPENCODE_CHILD_PID}" 2>/dev/null || true
  fi
}
cleanup_launcher() {
  cleanup_opencode
  if [ -n "${STABLE_ARTIFACT_DIR:-}" ] && [ -d "${STABLE_ARTIFACT_DIR}" ]; then
    rm -rf -- "${STABLE_ARTIFACT_DIR}"
  fi
}

trap cleanup_launcher EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

opencode_curl() {
  if [ -n "${OPENCODE_SERVER_PASSWORD:-}" ]; then
    curl -u "${OPENCODE_SERVER_USERNAME:-opencode}:${OPENCODE_SERVER_PASSWORD}" "$@"
  else
    curl "$@"
  fi
}

if [ -n "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "OpenCode auth: configured (user ${OPENCODE_SERVER_USERNAME:-opencode})"
else
  echo "OpenCode auth: not configured"
fi

if [ -n "${OPENCODE_BASE_URL:-}" ]; then
  # An explicit base URL means the caller owns the OpenCode server lifecycle.
  OPENCODE_BASE_URL="${OPENCODE_BASE_URL%/}"
  export OPENCODE_BASE_URL
  OPENCODE_HEALTH="${OPENCODE_BASE_URL}/api/health"
  echo "OpenCode: using configured server ${OPENCODE_BASE_URL}"

  if opencode_curl -sf -m 2 "${OPENCODE_HEALTH}" > /dev/null 2>&1; then
    echo "OpenCode: up"
  else
    OPENCODE_HTTP_STATUS="$(opencode_curl -s -o /dev/null -w '%{http_code}' -m 2 "${OPENCODE_HEALTH}" 2>/dev/null || true)"
    echo "OpenCode: WARNING - configured server is not healthy (HTTP ${OPENCODE_HTTP_STATUS:-unreachable})"
  fi
elif ! command -v opencode >/dev/null 2>&1; then
  # OpenCode is optional for baseline runtime startup. AI-backed parametric
  # generation remains unavailable until the operator installs OpenCode or
  # configures OPENCODE_BASE_URL, but built-in/native product workflows work.
  echo "OpenCode: optional CLI not installed; continuing without managed OpenCode"
else
  # No external server was configured and the CLI is available. Start a
  # Brepia-owned loopback OpenCode instance.
  if [ -n "${OPENCODE_PORT:-}" ]; then
    echo "OpenCode: using configured port ${OPENCODE_PORT}"
  else
    OPENCODE_PORT="$(choose_free_port)"
    export OPENCODE_PORT
    echo "OpenCode: dynamically selected port ${OPENCODE_PORT}"
  fi

  export OPENCODE_BASE_URL="http://${OPENCODE_HOST}:${OPENCODE_PORT}"
  OPENCODE_HEALTH="${OPENCODE_BASE_URL}/api/health"
  OPENCODE_LOG="/tmp/brepia-opencode-${OPENCODE_PORT}.log"
  echo "OpenCode: ${OPENCODE_BASE_URL}"

  opencode serve --port "${OPENCODE_PORT}" \
    --hostname "${OPENCODE_HOST}" \
    > "${OPENCODE_LOG}" 2>&1 &
  OPENCODE_CHILD_PID=$!

  # Wait for the managed server to become healthy (max 20 s). If the selected
  # port was stolen in the tiny allocation race, OpenCode exits and we fail
  # with its log instead of accidentally connecting to somebody else's server.
  OPENCODE_READY=0
  for _ in $(seq 1 20); do
    if opencode_curl -sf -m 2 "${OPENCODE_HEALTH}" > /dev/null 2>&1; then
      OPENCODE_READY=1
      break
    fi
    if ! kill -0 "${OPENCODE_CHILD_PID}" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if [ "${OPENCODE_READY}" -eq 1 ]; then
    echo "OpenCode: up (pid ${OPENCODE_CHILD_PID})"
  else
  echo "OpenCode: WARNING - managed server is unavailable; continuing without OpenCode"
    if [ -f "${OPENCODE_LOG}" ]; then
      echo "OpenCode log: ${OPENCODE_LOG}"
      tail -n 20 "${OPENCODE_LOG}" || true
    fi
    cleanup_opencode
    OPENCODE_BASE_URL=""
    unset OPENCODE_BASE_URL
  fi
fi

if [ "${BREPIA_ENABLE_HMR:-0}" = "1" ]; then
  echo "=== Starting development server (Vite/HMR enabled) ==="
  npm run dev
else
  echo "=== Building production-like stable runtime ==="
  export VITE_ENABLE_LIFECYCLE_DEBUG="${VITE_ENABLE_LIFECYCLE_DEBUG:-1}"
  STABLE_ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brepia-stable-artifact.XXXXXX")"
  export BREPIA_PUBLIC_ARTIFACT_DIR="${STABLE_ARTIFACT_DIR}"
  echo "Stable runtime artifact: isolated"
  npm run build

  if [ -z "${BREPIA_STABLE_APP_PORT:-}" ]; then
    BREPIA_STABLE_APP_PORT="$(choose_free_port)"
    export BREPIA_STABLE_APP_PORT
  fi
  echo "Stable runtime internal app port: ${BREPIA_STABLE_APP_PORT}"

  echo "=== Starting stable runtime (generated Nitro server, no Vite dev client) ==="
  node scripts/stable-runtime-proxy.mjs
fi
