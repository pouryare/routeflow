// Server-side link resolution shared by the single-link SearchBox flow and the bulk
// paste-import flow. Kept separate from lib/geoLinks.ts (pure, network-free helpers)
// since this does real fetches -- the redirect-following logic itself lives here so
// both call sites get the same SSRF guards instead of two hand-maintained copies.
import {
  extractLatLng,
  extractPlaceAddress,
  extractPlusCodeCoords,
  isAllowedLinkHost,
  isAllowedHop,
} from "@/lib/geoLinks";
import { extractViaBrowser, browserLifecycle } from "@/lib/playwrightExtract";
import type { LocationResolution } from "@/lib/db";
import { FETCH_TIMEOUT_MS, fetchNoRedirect } from "@/lib/fetchNoRedirect";

const MAX_REDIRECTS = 6;

export interface ResolvedLink {
  lat: number | null;
  lng: number | null;
  address: string | null;
  resolvedUrl: string;
  resolution: LocationResolution;
}

// Nominatim's usage policy caps public-instance traffic at 1 request/second --
// enforced here as a single shared queue so it holds regardless of how many links in a
// batch are being resolved concurrently upstream (resolveMapsLinks runs 4 at once).
let nominatimGate: Promise<void> = Promise.resolve();
function throttleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimGate.then(fn, fn);
  nominatimGate = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100))
  );
  return run;
}

interface NominatimResult {
  lat: string;
  lon: string;
  category: string;
  type: string;
}

// A road/highway/boundary match means the query string only lined up with a street or
// area name, not an actual venue -- not trustworthy enough to plant a pin from.
const WEAK_CATEGORIES = new Set(["highway", "boundary", "place"]);

async function nominatimSearch(query: string): Promise<NominatimResult | null> {
  return throttleNominatim(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("countrycodes", "ir");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": `routeflow-lead-import/1.0 (contact: ${process.env.CONTACT_EMAIL ?? "unset"})` },
      });
      if (!res.ok) return null;
      const results = (await res.json()) as NominatimResult[];
      const top = results[0];
      if (!top || WEAK_CATEGORIES.has(top.category)) return null;
      return top;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
}

const GENERIC_ADDRESS_SEGMENTS = new Set([
  "iran",
  "تهران",
  "tehran",
  "tehran province",
  "استان تهران",
  "tehran province tehran",
]);

// A Google place URL's address slug orders the venue name and the surrounding address
// inconsistently -- sometimes the name leads, sometimes it's the segment right before
// "Iran", sometimes it's buried mid-address with no separator at all. Rather than guess
// a fixed position, every plausible segment gets tried against Nominatim (which matches
// far better on the Persian venue name than the English one -- confirmed directly: an
// English "Fanoos Hall" search finds nothing, but the Persian "تالار پذیرایی نهاجا"
// pulled straight off the same address string finds the exact venue), longest first
// since the fuller phrase is more likely to be the actual business name.
function addressSegmentCandidates(address: string): string[] {
  return address
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !GENERIC_ADDRESS_SEGMENTS.has(s.toLowerCase()) && !/^district \d+$/i.test(s) && !/^منطقه [۰-۹0-9]+$/.test(s))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

async function resolveViaNominatim(address: string | null, fallbackName: string): Promise<{ lat: number; lng: number } | null> {
  const candidates = address ? addressSegmentCandidates(address) : [];
  // A bare pasted link has no name to fall back to -- better no geocode attempt at all
  // than spending the 1/sec Nominatim budget on an empty query.
  if (candidates.length === 0 && fallbackName.trim()) candidates.push(fallbackName.trim());
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const hit = await nominatimSearch(candidate);
    if (hit) {
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

// Resolves one maps-sharing URL to coordinates, following redirects by hand (checking
// each hop against isAllowedHop before the next request) exactly as
// /api/geo/decode-link does for a single pasted link. Never throws -- a link that
// can't be resolved comes back with resolution: "unresolved" rather than an error, so
// a bulk import of dozens of links can't be derailed by one bad one.
export async function resolveMapsLink(rawUrl: string, fallbackName = ""): Promise<ResolvedLink> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { lat: null, lng: null, address: null, resolvedUrl: rawUrl, resolution: "unresolved" };
  }
  if (!isAllowedLinkHost(current.hostname)) {
    return { lat: null, lng: null, address: null, resolvedUrl: rawUrl, resolution: "unresolved" };
  }

  const directHit = extractLatLng(current.href);
  if (directHit) {
    return { ...directHit, address: extractPlaceAddress(current.href), resolvedUrl: current.href, resolution: "direct" };
  }
  const plusHit = extractPlusCodeCoords(current.href);
  if (plusHit) {
    return { ...plusHit, address: extractPlaceAddress(current.href), resolvedUrl: current.href, resolution: "pluscode" };
  }

  // A Google "saved place" share link often resolves to a URL with no @lat,lng and
  // no Plus Code in its slug -- the only coordinate signal is inside the page's own
  // JS state, which a plain fetch can't read. Playwright executes that JS and pulls
  // the exact pin out. Tried before Nominatim because a browser-resolved pin is
  // exact, while Nominatim can only guess at the area.
  try {
    const browserHit = await extractViaBrowser(current.href);
    if (browserHit) {
      return {
        ...browserHit,
        address: extractPlaceAddress(browserHit.resolvedUrl),
        resolvedUrl: browserHit.resolvedUrl,
        resolution: "browser",
      };
    }
  } catch {
    /* fall through to Nominatim */
  }

  async function viaNominatimOrUnresolved(finalUrl: string): Promise<ResolvedLink> {
    const address = extractPlaceAddress(finalUrl);
    const nominatimHit = await resolveViaNominatim(address, fallbackName);
    if (nominatimHit) {
      return { ...nominatimHit, address, resolvedUrl: finalUrl, resolution: "nominatim" };
    }
    return { lat: null, lng: null, address, resolvedUrl: finalUrl, resolution: "unresolved" };
  }

  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const res = await fetchNoRedirect(current.href);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) break;

        const next = new URL(location, current);
        if (next.protocol !== "http:" && next.protocol !== "https:") break;
        if (!isAllowedHop(next)) {
          return { lat: null, lng: null, address: null, resolvedUrl: current.href, resolution: "unresolved" };
        }

        const direct = extractLatLng(next.href);
        const plus = direct ? null : extractPlusCodeCoords(next.href);
        current = next;
        if (direct) {
          return { ...direct, address: extractPlaceAddress(next.href), resolvedUrl: next.href, resolution: "direct" };
        }
        if (plus) {
          return { ...plus, address: extractPlaceAddress(next.href), resolvedUrl: next.href, resolution: "pluscode" };
        }
        continue;
      }

      await res.body?.cancel().catch(() => {});
      const finalUrl = res.url || current.href;
      const direct = extractLatLng(finalUrl);
      const plus = direct ? null : extractPlusCodeCoords(finalUrl);
      if (direct) return { ...direct, address: extractPlaceAddress(finalUrl), resolvedUrl: finalUrl, resolution: "direct" };
      if (plus) return { ...plus, address: extractPlaceAddress(finalUrl), resolvedUrl: finalUrl, resolution: "pluscode" };
      return await viaNominatimOrUnresolved(finalUrl);
    }
    return { lat: null, lng: null, address: null, resolvedUrl: current.href, resolution: "unresolved" };
  } catch {
    return { lat: null, lng: null, address: null, resolvedUrl: current.href, resolution: "unresolved" };
  }
}

// Resolves many links with modest concurrency -- polite to the destination services
// and to this server's own outbound connection pool, but far faster than resolving
// dozens of pasted links one at a time. Nominatim calls made along the way are still
// globally rate-limited to 1/sec regardless of this concurrency (see throttleNominatim).
export async function resolveMapsLinks(
  urls: string[],
  names: string[] = [],
  concurrency = 4
): Promise<ResolvedLink[]> {
  // One shared browser for the whole batch -- launching Chromium per link would
  // add seconds of overhead to every item that reaches the browser fallback.
  await browserLifecycle.getBrowser();
  try {
    const results = new Array<ResolvedLink>(urls.length);
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const i = next++;
        results[i] = await resolveMapsLink(urls[i], names[i] ?? "");
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return results;
  } finally {
    await browserLifecycle.closeBrowser();
  }
}
