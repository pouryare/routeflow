import { expect, it } from "vitest";
import { chromium } from "playwright";
import { sessionCookie } from "./session";
import { getSessionFromCookies } from "@/lib/session";
import { listBusinesses } from "@/lib/repo/crm/businesses";

// Opt-in read-only check against the already running dev server. Never submits a form.
it.skipIf(!process.env.CRM_READONLY_SMOKE_URL)("renders the real profile, inline editor and saved map without writes", async () => {
  const base = process.env.CRM_READONLY_SMOKE_URL!;
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] }); // WebGL for the map on a GPU-less runner
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const cookie = await sessionCookie();
    const session = await getSessionFromCookies(cookie.value);
    if (!session) throw new Error("No valid smoke session");
    const business = (await listBusinesses(session, { view: "all" })).rows[0];
    if (!business) throw new Error("No visible customer to verify");
    await context.addCookies([{ ...cookie, url: base }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => { errors.push(e.message); console.log("BROWSER_ERROR", e.message); });
    page.on("console", m => { if (m.type() === "error") console.log("BROWSER_CONSOLE", m.text().slice(0, 1000)); });
    page.on("requestfailed", r => console.log("FAILED_REQUEST", r.url(), r.failure()?.errorText));
    await page.route("**/api/**", route => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
    const response = await page.goto(`${base}/crm/${business.id}`, { timeout: 45000 });
    expect(response?.status()).toBe(200);
    console.log("PROFILE_READONLY_URL", page.url(), (await page.locator("body").innerText()).slice(0, 500));
    await page.getByRole("heading", { name: "اطلاعات کسب‌وکار", exact: true }).waitFor();
    await expect.poll(() => page.locator(".field-row .v").first().evaluate(el => getComputedStyle(el).fontSize)).toBe("15px");
    await expect.poll(() => page.locator(".field-row .cue").first().evaluate(el => getComputedStyle(el).fontSize)).toBe("12px");
    await page.getByRole("button", { name: "ویرایش نام کسب‌وکار", exact: true }).click();
    await page.getByRole("textbox", { name: "نام کسب‌وکار", exact: true }).waitFor();
    await page.getByRole("button", { name: "انصراف از ویرایش", exact: true }).click();
    if (await page.getByRole("button", { name: "بزرگ‌نمایی نقشه" }).count()) {
      await page.locator(".mini-map > .map-frame .maplibregl-marker").waitFor();
      await page.getByRole("button", { name: "بزرگ‌نمایی نقشه" }).click();
      await page.getByRole("dialog").waitFor();
      const enlarged = page.locator(".map-sheet .maplibregl-map");
      await enlarged.waitFor();
      // A pan moves the pin across the screen, which shows in its transform.
      const pane = enlarged.locator(".maplibregl-marker");
      const beforePan = await pane.getAttribute("style");
      const box = (await enlarged.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 12 });
      await page.mouse.up();
      await expect.poll(() => pane.getAttribute("style")).not.toBe(beforePan);
      expect(await enlarged.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      await page.getByRole("button", { name: "بستن نقشهٔ بزرگ", exact: true }).click();
    }
    const editLocation = page.getByRole("button", { name: "ویرایش موقعیت", exact: true });
    if (await editLocation.count()) {
      await editLocation.click();
      const editor = page.locator(".location-edit");
      const map = editor.locator(".maplibregl-map");
      await map.waitFor();
      await map.click({ position: { x: 180, y: 90 } });
      await editor.getByRole("textbox", { name: "لینک موقعیت" }).fill("https://maps.google.com/?q=35.72,51.42");
      await editor.getByRole("button", { name: "خواندن لینک موقعیت" }).click();
      await map.evaluate(el => el.setAttribute("data-preserved-map", "yes"));
      await editor.getByRole("button", { name: "بزرگ‌نمایی ناحیهٔ ویرایش" }).click();
      await expect.poll(() => map.evaluate(el => el.clientHeight)).toBeGreaterThan(300);
      expect(await page.getByRole("dialog", { name: "ویرایش موقعیت", exact: true }).count()).toBe(1);
      expect(await map.getAttribute("data-preserved-map")).toBe("yes");
      await page.keyboard.press("Escape");
      expect(await editor.getAttribute("role")).toBeNull();
      expect(await map.getAttribute("data-preserved-map")).toBe("yes");
      expect(await editor.getByRole("textbox", { name: "لینک موقعیت" }).inputValue()).toContain("35.72,51.42");
      await editor.getByRole("button", { name: "انصراف از ثبت موقعیت", exact: true }).click();
      await page.locator(".mini-map > .map-frame .maplibregl-marker").waitFor();
    }
    for (const width of [360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/rf-profile-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});
