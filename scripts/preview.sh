#!/usr/bin/env bash
# Serve the current build against a throwaway database, for browser checks.
#
# DATABASE_URL names the PostgreSQL server (any database on it); the preview uses its own database,
# rf_preview (PREVIEW_DB to change it), built from the small demo dataset the first time. It never
# touches the database DATABASE_URL names: that is live customer data, and a preview that can write
# to it is one stray click from editing production. Delete the preview data with
# `npm run seed:demo -- --scale=smoke --db=rf_preview --force`.
#
# `next start` spawns a child `next-server` process that outlives a kill of its parent,
# so the port is freed by port rather than by process name -- otherwise every restart
# hits EADDRINUSE and serves the previous build without saying so.
set -euo pipefail

PORT=${PORT:-3099}
DB=${PREVIEW_DB:-rf_preview}
: "${DATABASE_URL:?DATABASE_URL is required (the server; the preview gets its own database on it)}"

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

PREVIEW_URL=$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/"+process.argv[1];console.log(u.toString())' "$DB")
if ! psql "$PREVIEW_URL" -Atqc "SELECT 1" >/dev/null 2>&1; then
  echo "→ building the demo data in $DB"
  npm run seed:demo -- --scale=smoke --db="$DB" --force
fi

echo "→ preview on :$PORT against $DB"
DATABASE_URL="$PREVIEW_URL" \
SESSION_SECRET="${SESSION_SECRET:-preview-secret-not-for-production-0123456789}" \
  exec npx next start -p "$PORT" -H 127.0.0.1
