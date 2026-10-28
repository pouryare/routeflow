import { expect, it } from "vitest";
import { chromium } from "playwright";
import { sessionCookie } from "./session";

it.skipIf(!process.env.CRM_READONLY_SMOKE_URL)("replaces an obsolete cached map chunk with the active service worker", async () => {
  const base = process.env.CRM_READONLY_SMOKE_URL!;
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] }); // WebGL for the map on a GPU-less runner
  try {
    const context = await browser.newContext({ serviceWorkers: "allow" });
    await context.addCookies([{ ...await sessionCookie(), url: base }]);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const errors: string[] = [];
    const missing: string[] = [];
    const chunks = new Set<string>();
    page.on("pageerror", e => errors.push(e.message));
    page.on("response", r => {
      if (r.url().includes("/_next/static/") && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
      if (r.url().includes("CustomerLocationMap") && r.url().endsWith(".js")) chunks.add(r.url());
    });
    await page.goto(`${base}/crm/5`);
    await page.locator(".mini-map > .map-frame .maplibregl-marker").waitFor();
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await registration.update();
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    });
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${base}/sw.js`);
    expect(chunks.size).toBeGreaterThan(0);
    const chunk = [...chunks][0];
    await page.evaluate(async url => {
      const cache = await caches.open("shell-v3");
      await cache.put(url, new Response('throw new Error("OBSOLETE_MAP_CHUNK_EXECUTED")', {
        headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache, must-revalidate" },
      }));
    }, chunk);
    await page.reload();
    await page.locator(".mini-map > .map-frame .maplibregl-marker").waitFor();
    await page.getByRole("button", { name: "بزرگ‌نمایی نقشه" }).click();
    await page.getByRole("dialog").locator(".maplibregl-marker").waitFor();
    await page.getByRole("button", { name: "بستن نقشهٔ بزرگ", exact: true }).click();
    expect(await page.evaluate(async url => !!(await (await caches.open("shell-v3")).match(url)), chunk)).toBe(false);
    expect(missing).toEqual([]);
    expect(errors).toEqual([]);
    console.log("ACTIVE_WORKER_MAP_PASS", { chunk, errors, missing });
  } finally { await browser.close(); }
});
