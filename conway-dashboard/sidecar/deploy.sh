#!/bin/bash
# Deploy sidecar + frontend to a Conway Cloud sandbox
# Usage: ./deploy.sh <SANDBOX_ID> [CONWAY_API_KEY]
#
# Prerequisites:
#   - npm run build (creates dist/ with frontend)
#   - Conway Cloud sandbox running with automaton

set -euo pipefail

SANDBOX_ID="${1:?Usage: ./deploy.sh <SANDBOX_ID> [CONWAY_API_KEY]}"
API_KEY="${2:-${CONWAY_API_KEY:?Set CONWAY_API_KEY or pass as second argument}}"
API_BASE="https://api.conway.tech/v1"

echo "==> Building frontend..."
(cd "$(dirname "$0")/.." && npm run build)

echo "==> Uploading sidecar to sandbox ${SANDBOX_ID}..."

# Create sidecar directory in sandbox
curl -sf -X POST "${API_BASE}/sandboxes/${SANDBOX_ID}/exec" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"command": "mkdir -p /home/sidecar/dist"}' > /dev/null

# Upload sidecar files
for file in server.ts package.json; do
  echo "    uploading sidecar/${file}"
  CONTENT=$(cat "$(dirname "$0")/${file}" | jq -Rs .)
  curl -sf -X POST "${API_BASE}/sandboxes/${SANDBOX_ID}/exec" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"command\": \"cat > /home/sidecar/${file} << 'SIDECAR_EOF'\n$(cat "$(dirname "$0")/${file}")\nSIDECAR_EOF\"}" > /dev/null
done

# Upload built frontend
echo "    uploading dist/..."
DIST_DIR="$(dirname "$0")/../dist"
for file in $(find "${DIST_DIR}" -type f); do
  REL_PATH="${file#${DIST_DIR}/}"
  echo "    uploading dist/${REL_PATH}"
  curl -sf -X POST "${API_BASE}/sandboxes/${SANDBOX_ID}/exec" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"command\": \"mkdir -p /home/sidecar/dist/$(dirname "${REL_PATH}") && cat > /home/sidecar/dist/${REL_PATH} << 'DIST_EOF'\n$(cat "${file}")\nDIST_EOF\"}" > /dev/null
done

# Install dependencies and start sidecar
echo "==> Installing sidecar dependencies..."
curl -sf -X POST "${API_BASE}/sandboxes/${SANDBOX_ID}/exec" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"command": "cd /home/sidecar && npm install --production", "timeout": 60000}' > /dev/null

echo "==> Starting sidecar..."
curl -sf -X POST "${API_BASE}/sandboxes/${SANDBOX_ID}/exec" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"command": "cd /home/sidecar && DB_PATH=/home/automaton/state.db nohup npm start > /tmp/sidecar.log 2>&1 &"}' > /dev/null

# Expose port
echo "==> Exposing port 3000..."
curl -sf -X POST "${API_BASE}/sandboxes/${SANDBOX_ID}/ports" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"port": 3000}' > /dev/null || true

echo ""
echo "==> Done! Sidecar deployed."
echo "    Dashboard: https://3000-${SANDBOX_ID}.life.conway.tech"
echo "    Summary:   https://3000-${SANDBOX_ID}.life.conway.tech/api/summary"
echo "    Health:    https://3000-${SANDBOX_ID}.life.conway.tech/api/health"
