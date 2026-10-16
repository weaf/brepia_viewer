#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ "${BREPIA_ENABLE_HMR:-0}" = "1" ]; then
  echo "=== Starting development server (Vite/HMR enabled) ==="
  exec npm run dev
fi

echo "=== Building Brepia Viewer ==="
STABLE_ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brepia-stable-artifact.XXXXXX")"
export BREPIA_PUBLIC_ARTIFACT_DIR="${STABLE_ARTIFACT_DIR}"
cleanup() {
  rm -rf -- "${STABLE_ARTIFACT_DIR}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
npm run build

if [ -z "${BREPIA_STABLE_APP_PORT:-}" ]; then
  BREPIA_STABLE_APP_PORT="$(node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.unref();
server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
)"
  export BREPIA_STABLE_APP_PORT
fi

echo "Stable runtime internal app port: ${BREPIA_STABLE_APP_PORT}"
node scripts/stable-runtime-proxy.mjs
