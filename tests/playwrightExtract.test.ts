import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractViaBrowser, browserLifecycle } from "@/lib/playwrightExtract";

// These tests hit real Google Maps short links, so they need a browser binary
// installed (`npx playwright install chromium`). Gated on PLAYWRIGHT_REAL_URLS
// so CI without a browser doesn't try to launch one.
const REAL = process.env.PLAYWRIGHT_REAL_URLS;

// Item 1 from the pasted chat -- a "saved place" share link whose resolved URL
// carries no @lat,lng and no Plus Code. Only the page's JS state has the pin.
const ITEM_1 = "https://maps.app.goo.gl/CV5bnCA2xDw8ZNBk6";
// Item 4 -- same shape, different venue.
const ITEM_4 = "https://maps.app.goo.gl/HhuT17iwDaG6xL6k9";
// Item 2 -- a share link whose resolved URL DOES carry @lat,lng in the final URL.
const ITEM_2_SHARE = "https://maps.app.goo.gl/tLGwAJyvYPJoNHoB6";

describe.skipIf(!REAL)("extractViaBrowser on real Google Maps short links", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it("extracts exact venue coordinates from a saved-place share link (item 1)", async () => {
    const result = await extractViaBrowser(ITEM_1);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeGreaterThan(34);
    expect(result!.lat).toBeLessThan(37);
    expect(result!.lng).toBeGreaterThan(50);
    expect(result!.lng).toBeLessThan(53);
    expect(result!.resolvedUrl).toContain("google.com/maps/place/");
  }, 30_000);

  it("extracts exact venue coordinates from a saved-place share link (item 4)", async () => {
    const result = await extractViaBrowser(ITEM_4);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeGreaterThan(34);
    expect(result!.lat).toBeLessThan(37);
    expect(result!.lng).toBeGreaterThan(50);
    expect(result!.lng).toBeLessThan(53);
  }, 30_000);

  it("extracts coordinates from a share link whose URL carries @lat,lng", async () => {
    const result = await extractViaBrowser(ITEM_2_SHARE);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(35.7491, 3);
    expect(result!.lng).toBeCloseTo(51.7973, 3);
  }, 30_000);

  it("returns null for a non-map URL", async () => {
    const result = await extractViaBrowser("https://example.com/no-coordinates-here");
    expect(result).toBeNull();
  }, 30_000);

  it("returns null for a malformed URL", async () => {
    const result = await extractViaBrowser("not-a-url");
    expect(result).toBeNull();
  }, 30_000);
});

describe("browserLifecycle", () => {
  it("shares one browser instance and closes it cleanly", async () => {
    const b1 = await browserLifecycle.getBrowser();
    const b2 = await browserLifecycle.getBrowser();
    expect(b1).toBe(b2);
    await browserLifecycle.closeBrowser();
    // After close, a new getBrowser() must create a fresh instance.
    const b3 = await browserLifecycle.getBrowser();
    expect(b3).not.toBe(b1);
    await browserLifecycle.closeBrowser();
  }, 30_000);
});