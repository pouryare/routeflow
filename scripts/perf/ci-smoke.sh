#!/usr/bin/env bash
# Builds the app, seeds the small demo dataset, starts the production server and runs the timing
# script against it with a budget. Used by CI; also handy locally:  bash scripts/perf/ci-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

WORK="$(mktemp -d)"
export ROUTEFLOW_DB_PATH="$WORK/ci.db"
export SESSION_SECRET="${SESSION_SECRET:-ci-secret-not-for-production}"
export NEXT_TELEMETRY_DISABLED=1
PORT="${PORT:-3100}"
BUDGET="${PERF_BUDGET_MS:-1500}"

npm run seed:demo -- --scale=smoke --db="$ROUTEFLOW_DB_PATH" --force > "$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log"; exit 1; }
npm run build > "$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }

npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://localhost:$PORT/login" && break
  sleep 1
done

COOKIE="$(curl -s -i -X POST "http://localhost:$PORT/api/login" -H 'content-type: application/json' \
  -d '{"username":"demo.owner","password":"demo1234"}' | grep -i '^set-cookie' | sed 's/^[^:]*: //; s/;.*//')"
[ -n "$COOKIE" ] || { echo "login failed"; cat "$WORK/server.log"; exit 1; }

SESSION_COOKIE="$COOKIE" PERF_BUDGET_MS="$BUDGET" node scripts/perf/timing.mjs "http://localhost:$PORT"
