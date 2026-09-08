#!/usr/bin/env bash
# Serve the current build against a throwaway database, for browser checks.
#
# Never points at data/routeflow.db: that is live customer data, and a preview that can
# write to it is one stray click from editing production.
#
# `next start` spawns a child `next-server` process that outlives a kill of its parent,
# so the port is freed by port rather than by process name -- otherwise every restart
# hits EADDRINUSE and serves the previous build without saying so.
set -euo pipefail

PORT=${PORT:-3099}
DB=${PREVIEW_DB:-/tmp/coverage-preview.db}

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

echo "→ preview on :$PORT against $DB"
ROUTEFLOW_DB_PATH="$DB" \
SESSION_SECRET="${SESSION_SECRET:-preview-secret-not-for-production}" \
  exec npx next start -p "$PORT" -H 127.0.0.1
