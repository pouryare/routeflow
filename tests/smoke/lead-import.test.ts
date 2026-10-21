import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startDevServer, BASE } from "./server";
import { sessionCookie } from "./session";

/** The bulk import path, end to end, in a real browser.
 *
 *  The unit tests cover the runner, the scheduler and the repo. This one covers the thing
 *  none of them can: that the box on /leads actually accepts a paste, creates a job, shows
 *  progress, and reports an outcome -- through a real HTTP request, a real poll, and a
 *  real render.
 *
 *  The paste carries a URL whose coordinates are already in its slug. That is deliberate:
 *  it settles on the first, cheapest step of the cascade with no outbound network call, so
 *  the test exercises the whole job lifecycle without depending on Google, Chromium, or a
 *  Nominatim request surviving the day. A test that needs the internet to prove a wiring
 *  change is a test that fails for the wrong reason. */
let browser: Browser;
let stop: () => Promise<void>;
let page: Page;

beforeAll(async () => {
  stop = await startDevServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ locale: "fa-IR", viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ ...sessionCookie(), url: BASE }]);
  page = await context.newPage();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

/* A www.google.com/maps/place URL with the coordinates already in the slug.
   The host matters: lib/pasteImport.ts's MAP_LINK_RE matches www.google.com/maps and
   maps.app.goo.gl, but NOT maps.google.com -- the short-form host is not in the pattern,
   and a test that uses it gets a 422 "no map link found" and looks like a broken app. */
const EASY_LINK = "https://www.google.com/maps/place/test/@35.7219,51.3347,14z";

describe("bulk lead import", () => {
  it("accepts a paste and reaches a finished state", async () => {
    await page.goto(`${BASE}/leads`, { waitUntil: "load" });

    /* The import panel is behind isManager, which arrives from an async /api/me fetch, so
       it is not in the server HTML. Waiting for the heading rather than a fixed pause is
       what makes this reliable on a cold dev server, where the first /api/me request pays
       a compile. */
    await page.getByText("افزودن از لینک").waitFor({ timeout: 60_000 });
    await page.getByPlaceholder(/لینک یا نتیجه جستجوی گوگل‌مپ/).fill(`رستوران آزمایشی\n${EASY_LINK}`);
    await page.getByRole("button", { name: "تجزیه" }).click();

    // The console replaces the paste box. Waiting for it is what proves the job started.
    const bar = page.getByRole("progressbar", { name: "پیشرفت پردازش لینک‌ها" });
    await bar.waitFor({ timeout: 30_000 });

    // Either it is still running, or it already finished -- both are correct. What must
    // never happen is the job hanging with no way to tell how far along it is.
    await expect
      .poll(
        async () => {
          const pct = await bar.getAttribute("aria-valuenow").catch(() => null);
          return pct;
        },
        { timeout: 45_000, interval: 500 }
      )
      .toBe("1");
  }, 90_000);

  it("reports what it added once the job finishes", async () => {
    // The panel carries the outcome in the summary line, which only exists after the run.
    await page
      .getByText(/مکان اضافه شد|نیاز به بررسی دارد/)
      .waitFor({ timeout: 30_000 });
  }, 60_000);
});
