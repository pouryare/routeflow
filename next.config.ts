import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Pragmatic CSP, not a strict nonce-based one: this app's login page ships one
// inline <style> keyframe and Next's own hydration/RSC payloads rely on inline
// <script> tags, so script-src/style-src keep 'unsafe-inline' rather than chasing a
// nonce wired through proxy.ts -- still meaningfully narrows the attack surface by
// blocking arbitrary *external* script/resource injection, which is the actual risk
// for an app that renders user-entered notes/captions.
//
// connect-src repeats the tile/satellite hosts already listed under img-src: the
// service worker (public/sw.js) caches map tiles via its own fetch(), a "connect"
// request from CSP's point of view, not an "image" one -- img-src alone is enough
// for a plain <img src>, but not for the SW's cache-then-fetch path, which silently
// fails under a mismatched CSP with no violation reported on the page itself (the
// failure happens inside the worker's scope) and just shows up as tiles never loading.
/* React's development build rebuilds server call stacks with eval(); without it every dev
   page logs an error. Keyed on Next's own phase, not on NODE_ENV: a dev server spawned by
   the test runner inherits NODE_ENV=test, which silently dropped the flag. Production
   never evals, so production never gets it. */
const csp = (dev: boolean) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org https://*.tile.openstreetmap.fr https://tiles.stadiamaps.com https://api.maptiler.com https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com",
  "font-src 'self' data:",
  /* MapLibre compiles its shaders in a web worker created from a blob: URL, so worker-src
     has to allow blob: or every vector basemap fails to initialise. It is not a general
     script-src loosening -- worker-src is its own directive and does not fall back to
     script-src once stated. */
  "worker-src 'self' blob:",
  "connect-src 'self' https://server.arcgisonline.com https://tile.openstreetmap.org https://*.tile.openstreetmap.fr https://tiles.stadiamaps.com https://api.maptiler.com https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://router.project-osrm.org https://nominatim.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig = (phase: string): NextConfig => ({
  async headers() {
    const CSP = csp(phase === PHASE_DEVELOPMENT_SERVER);
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Files under public/ are served with max-age=0 by default, so the map was
        // re-fetching this 13KB reference boundary on every single load. It's fixed
        // survey data with no version stamp in its URL, hence a day of hard caching
        // plus a week of stale-while-revalidate rather than "immutable" -- a bad copy
        // ages out on its own instead of being stuck in a browser forever.
        source: "/tehran-city-boundary.geojson",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
});

export default nextConfig;
