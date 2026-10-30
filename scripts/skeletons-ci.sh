#!/usr/bin/env bash
# Recaptures the page skeletons on a throwaway demo database; used by .github/workflows/skeletons.yml,
# and handy locally:  DATABASE_URL=postgres://… bash scripts/skeletons-ci.sh
# Leaves the new files in lib/skeletons/; committing them is the workflow's job.
set -euo pipefail
cd "$(dirname "$0")/../.."

WORK="$(mktemp -d)"
: "${DATABASE_URL:?DATABASE_URL is required (the server; the demo goes to its own database)}"
DEMO_DB="rf_skeletons_ci"
export SESSION_SECRET="${SESSION_SECRET:-ci-secret-not-for-production-0123456789}"
export NEXT_TELEMETRY_DISABLED=1
export DEMO_PASSWORD="${DEMO_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -d "+/=")}"
PORT="${PORT:-3101}"

# A fixed anchor date, so the demo is the same dataset on every run.
npm run seed:demo -- --scale=smoke --as-of=2026-10-01 --db="$DEMO_DB" --force > "$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log"; exit 1; }
npm run build > "$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }

DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/"+process.argv[1];console.log(u.toString())' "$DEMO_DB")" npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://localhost:$PORT/login" && break
  sleep 1
done

PORT="$PORT" node scripts/capture-skeletons.mjs
