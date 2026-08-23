// Runs once when the server starts, before it accepts requests.
//
// District geometry is compressed with brotli at maximum quality: on this dataset that
// buys ~26% over the fast setting (134KB vs 181KB), which is worth a lot when the result
// is cached indefinitely in every field phone's disk cache -- but it costs ~1.5s per
// tier to produce. Building both tiers here moves that off whatever unlucky request
// arrives first after a deploy, at the price of a slightly slower `systemctl restart`.
export async function register() {
  // Guard the runtime: `register` also runs on the edge runtime, which has neither
  // node:sqlite nor node:zlib.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { geometryVersion, getGeometryPayload } = await import("./lib/districtGeometry");
    const version = geometryVersion();
    for (const tier of ["low", "high"] as const) {
      getGeometryPayload(version, tier, "br");
    }
  } catch (err) {
    // A cold cache is a slow first request, not a broken server -- never let this stop
    // the app from booting (an unseeded or locked DB on a fresh machine, say).
    console.warn("[instrumentation] district geometry warm-up skipped:", err);
  }
}
