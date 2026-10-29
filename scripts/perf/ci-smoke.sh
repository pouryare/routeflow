#!/usr/bin/env bash
# Builds the app, seeds the small demo dataset, starts the production server and runs the timing
# script against it with a budget. Used by CI; also handy locally:  bash scripts/perf/ci-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

WORK="$(mktemp -d)"
# DATABASE_URL names the server (CI: the postgres service); the demo goes to its own database.
: "${DATABASE_URL:?DATABASE_URL is required}"
DEMO_DB="rf_perf_smoke"
export SESSION_SECRET="${SESSION_SECRET:-ci-secret-not-for-production-0123456789}"
export NEXT_TELEMETRY_DISABLED=1
export DEMO_PASSWORD="${DEMO_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -d "+/=")}"
PORT="${PORT:-3100}"
BUDGET="${PERF_BUDGET_MS:-1500}"

npm run seed:demo -- --scale=smoke --db="$DEMO_DB" --force > "$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log"; exit 1; }
npm run build > "$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }

DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/"+process.argv[1];console.log(u.toString())' "$DEMO_DB")" npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://localhost:$PORT/login" && break
  sleep 1
done

COOKIE="$(curl -s -i -X POST "http://localhost:$PORT/api/login" -H 'content-type: application/json' \
  -d '{"username":"demo.owner","password":"'"$DEMO_PASSWORD"'"}' | grep -i '^set-cookie' | sed 's/^[^:]*: //; s/;.*//')"
[ -n "$COOKIE" ] || { echo "login failed"; cat "$WORK/server.log"; exit 1; }

SESSION_COOKIE="$COOKIE" PERF_BUDGET_MS="$BUDGET" node scripts/perf/timing.mjs "http://localhost:$PORT"
