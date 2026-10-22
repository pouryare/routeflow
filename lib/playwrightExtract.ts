// Browser-based coordinate extraction for Google Maps share links that carry no
// direct @lat,lng and no Plus Code in their URL slug. Playwright executes the page's
// own JS, which reads window.APP_INITIALIZATION_STATE -- the same object the
// interactive map draws from -- and yields the exact venue pin that a plain fetch()
// cannot see (Google's unauthenticated HTML for these links contains only the
// camera center, not the pin).
//
// Kept separate from geoLinks.ts (pure, network-free) since this needs a browser
// lifecycle, and from resolveMapsLink.ts (fetch-based) since it is the last resort
// in the resolution chain, not a step every link takes.

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { browserRequestAllowed, isValidCoord } from "@/lib/geoLinks";

// Tehran province bounds -- generous enough to accept any venue in the region
// while rejecting the camera-center defaults (e.g. 0,0) that show up on blank
// or bot-detection pages.
const MIN_LAT = 34;
const MAX_LAT = 37;
const MIN_LNG = 50;
const MAX_LNG = 53;

const FETCH_TIMEOUT_MS = 12000;

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.contexts().length >= 0) {
    try {
      if (browser.isConnected()) return browser;
    } catch {
      /* fall through and re-create */
    }
  }
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {
      /* already gone */
    }
    browser = null;
  }
}

// Exported so resolveMapsLinks (bulk) can share one browser across workers and
// close it when the batch is done, instead of paying the launch penalty per link.
export const browserLifecycle = { getBrowser, closeBrowser };

// Coordinate pairs that appear in APP_INITIALIZATION_STATE -- Google renders them
// as [lat,lng] strings inside a deeply nested array. The regex is deliberately
// loose: it catches every float pair in the page's JS state, and the Tehran-bounds
// filter below narrows it to the actual venue pin. The first coordinate pair
// inside Tehran bounds is the pin; subsequent ones are the same pin repeated in
// different representations (E7 integers, reversed [lng,lat], camera center).
function extractCoordsFromText(text: string): { lat: number; lng: number } | null {
  const pairs = text.match(/(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/g);
  if (!pairs) return null;
  for (const raw of pairs) {
    const m = raw.match(/(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Try both orderings: [lat,lng] and [lng,lat]
    if (a >= MIN_LAT && a <= MAX_LAT && b >= MIN_LNG && b <= MAX_LNG) {
      return { lat: a, lng: b };
    }
    if (b >= MIN_LAT && b <= MAX_LAT && a >= MIN_LNG && a <= MAX_LNG) {
      return { lat: b, lng: a };
    }
  }
  return null;
}

// Pulls the first @lat,lng,zoom camera marker out of a final URL -- a cheap
// fallback in case the page settled on a URL that does carry coordinates.
function extractFromUrl(url: string): { lat: number; lng: number } | null {
  const m = url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return isValidCoord(lat, lng) ? { lat, lng } : null;
}

/** Title of the one-line page that stands in for an HTTP redirect (see installRequestGuard). */
export const REDIRECT_STUB_TITLE = "__rf_redirect__";

/** Every request this browser makes passes through here, so a link on an allowed site that
 *  redirects to an internal address (or to a site off the allow-list) is refused before any
 *  request leaves the machine. Without it Chromium follows redirects freely and runs whatever
 *  page it lands on, from inside the server's network.
 *
 *  Chromium follows an HTTP redirect inside its network stack and does NOT call a route handler
 *  again for the target, so `route.continue()` alone vets only the first hop. For a top-level
 *  navigation the guard therefore fetches the page itself WITHOUT following redirects. A 3xx is
 *  not passed on: its target is checked, and if allowed the browser is handed a stub page that
 *  navigates there, which is a fresh navigation and comes back through this handler. Every hop is
 *  vetted, however long the chain. Sub-resources (scripts, tiles) keep `continue()`: their
 *  redirects are not readable by the page and the pages in question are the map services'. */
export async function installRequestGuard(
  context: Pick<BrowserContext, "route">,
  /** The request policy. Only a test passes one (to point the guard at local servers). */
  allowed: (url: string, isNavigation: boolean) => boolean = browserRequestAllowed
): Promise<void> {
  await context.route("**/*", async (route: Route) => {
    const req = route.request();
    const navigation = req.isNavigationRequest();
    if (!allowed(req.url(), navigation)) return route.abort("blockedbyclient");
    if (!navigation || !/^https?:/i.test(req.url())) return route.continue();

    let res;
    try {
      res = await route.fetch({ maxRedirects: 0 });
    } catch {
      return route.abort("failed");
    }
    const status = res.status();
    if (status < 300 || status >= 400) return route.fulfill({ response: res });

    const location = res.headers()["location"];
    let next: string;
    try {
      next = new URL(location ?? "", req.url()).href;
    } catch {
      return route.abort("blockedbyclient");
    }
    if (!allowed(next, true)) return route.abort("blockedbyclient");
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${REDIRECT_STUB_TITLE}</title><script>location.replace(${JSON.stringify(next).replace(/</g, "\\u003c")})</script>`,
    });
  });
}

export interface BrowserExtractResult {
  lat: number;
  lng: number;
  resolvedUrl: string;
}

// Navigates to a maps-sharing URL in a headless Chromium instance and extracts
// the exact venue pin from the page's JS state. Returns null on any failure
// (timeout, crash, bot page, no coords) -- the caller falls through to the next
// resolution strategy. Never throws.
export async function extractViaBrowser(url: string): Promise<BrowserExtractResult | null> {
  let page: Page | null = null;
  let context: BrowserContext | null = null;
  try {
    const b = await getBrowser();
    // A fresh context per link, so the request guard is installed before the first request and
    // no cookie or storage from one pasted link can reach the next.
    context = await b.newContext();
    await installRequestGuard(context);
    page = await context.newPage();
    // A long-lived navigation timeout; we'd rather fall through to Nominatim
    // than hang the whole batch on one slow host.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: FETCH_TIMEOUT_MS,
    });
    // Let the map's own JS initialise -- APP_INITIALIZATION_STATE is populated
    // after the scripts run, not at domcontentloaded.
    await page.waitForTimeout(2000);

    /* A redirect is served as a stub page that navigates on (see installRequestGuard); wait for
       the chain to settle on a real page, bounded. */
    for (let hop = 0; hop < 8; hop++) {
      const onStub = await page.title().then((t) => t === REDIRECT_STUB_TITLE, () => true);
      if (!onStub) break;
      await page.waitForEvent("framenavigated", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    const finalUrl = page.url();

    // 1. The pin, straight from the page's JS state.
    const stateCoords = await page.evaluate(() => {
      const state = (window as unknown as { APP_INITIALIZATION_STATE?: unknown })
        .APP_INITIALIZATION_STATE;
      return state ? JSON.stringify(state) : "";
    });
    if (stateCoords) {
      const hit = extractCoordsFromText(stateCoords);
      if (hit) return { ...hit, resolvedUrl: finalUrl };
    }

    // 2. Fallback: the settled URL itself may carry @lat,lng.
    const urlHit = extractFromUrl(finalUrl);
    if (urlHit) return { ...urlHit, resolvedUrl: finalUrl };

    return null;
  } catch {
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* page already gone */
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        /* context already gone */
      }
    }
  }
}