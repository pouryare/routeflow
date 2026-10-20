// Usage: SESSION_COOKIE='coverage_session_v2=<value>' node scripts/perf/timing.mjs http://localhost:3000
// Run against `next start`, not `next dev`. Prints, for each route, cold (first hit) and warm
// (median of 5): time to the response headers (ttfb), to the first chunk of the body (first,
// when the page starts to appear) and to the last byte (total). On a streamed page `first` is
// well below `total`.
const base = process.argv[2] ?? "http://localhost:3000";
const cookie = process.env.SESSION_COOKIE ?? "";
const routes = [
  "/crm", "/sales/dashboard", "/sales/orders", "/sales/orders?view=board",
  "/sales/orders?view=journey", "/sales/schedule", "/leads", "/map",
  "/accounting/journal", "/accounting/trial-balance",
];

async function hit(path) {
  const t0 = performance.now();
  const res = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const ttfb = performance.now() - t0;
  let first = ttfb;
  const reader = res.body?.getReader();
  let sawFirst = false;
  while (reader) {
    const { done } = await reader.read();
    if (!sawFirst) { first = performance.now() - t0; sawFirst = true; }
    if (done) break;
  }
  return { status: res.status, ttfb, first, total: performance.now() - t0 };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

for (const path of routes) {
  const cold = await hit(path);
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push(await hit(path));
  console.log(
    `${path.padEnd(28)} ${cold.status} cold first ${cold.first.toFixed(0)}ms total ${cold.total.toFixed(0)}ms | ` +
      `warm ttfb ${median(warm.map((w) => w.ttfb)).toFixed(0)}ms first ${median(warm.map((w) => w.first)).toFixed(0)}ms total ${median(warm.map((w) => w.total)).toFixed(0)}ms`
  );
}
