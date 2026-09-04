#!/usr/bin/env node
// Fires one sweep endpoint against the local production server using the shared
// SWEEP_TOKEN. Run standalone by systemd (see coverage-map-sweep-*.service), mirroring
// scripts/backup.mjs conventions: config comes from
// process.env the way systemd's EnvironmentFile= injects it.
//
//   node scripts/run-sweeps.mjs <rules|analysis|predict>
//
// The sweep logic itself lives in lib/repo/* and is complex, so this hits the HTTP
// route (which loops every organisation for a token caller) rather than forking it.

const BASE = process.env.SWEEP_BASE_URL || "http://127.0.0.1:3003";
const TOKEN = process.env.SWEEP_TOKEN;

const PATHS = {
  rules: "/api/rules/run",
  analysis: "/api/analysis/refresh",
  predict: "/api/predict/refresh",
};

const which = process.argv[2];

if (!TOKEN) {
  console.error("[sweep] SWEEP_TOKEN is not set — refusing to run");
  process.exit(1);
}
if (!PATHS[which]) {
  console.error(`[sweep] usage: run-sweeps.mjs <${Object.keys(PATHS).join("|")}>`);
  process.exit(2);
}

const url = BASE + PATHS[which];
const startedAt = new Date().toISOString();

let res;
try {
  res = await fetch(url, { method: "POST", headers: { "x-sweep-token": TOKEN } });
} catch (err) {
  console.error(`[sweep] ${which} ${startedAt} — request failed: ${err.message}`);
  process.exit(1);
}

const body = await res.text();
const line = `[sweep] ${which} ${startedAt} -> HTTP ${res.status} ${body.slice(0, 800)}`;

if (res.ok) {
  console.log(line);
  process.exit(0);
}
console.error(line);
process.exit(1);
