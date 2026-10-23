import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { startDevServer, BASE } from "./server";
import { sessionCookie } from "./session";

let browser: Browser;
let stop: () => Promise<void>;
let db: DatabaseSync;
beforeAll(async () => {
  /* startDevServer repoints ROUTEFLOW_DB_PATH at a fresh VACUUM copy; open the DB only
   * after that, or the writes land in production while the server reads the snapshot. */
  stop = await startDevServer();
  db = new DatabaseSync(process.env.ROUTEFLOW_DB_PATH!);
  browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); await stop?.(); db.close(); });
it("edits tags, Instagram and pre-visit intel on a snapshot, persisting across reload", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ ...sessionCookie(), url: BASE }]);
  const user = db.prepare("SELECT organization_id FROM users WHERE active=1 ORDER BY CASE role WHEN 'platform_owner' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END,id LIMIT 1").get() as { organization_id: number };
  const id = Number(db.prepare("INSERT INTO customers (organization_id,customer_code,business_name,synced_at,lat,lng) VALUES (?,?,'آزمایش شناخت',?,35.7,51.4)").run(user.organization_id, `smoke-intel-${Date.now()}`, new Date().toISOString()).lastInsertRowid);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 400)}`); });
  await page.goto(`${BASE}/crm/${id}`);
  await page.getByRole("button", { name: "افزودن برچسب‌ها" }).or(page.getByRole("button", { name: "ویرایش برچسب‌ها" })).click();
  await page.getByRole("textbox", { name: "برچسب‌ها", exact: true }).fill("ویژه، بازدید");
  await page.getByRole("button", { name: "ذخیرهٔ تغییر", exact: true }).click();
  // The phone nav's closed sheets stay in the DOM (inert), so wait on the live one only.
  await page.locator('[role="dialog"]:not([inert])').waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /اینستاگرام/ }).click();
  await page.getByRole("textbox", { name: "اینستاگرام", exact: true }).fill("@smoke.intel");
  const patched = page.waitForResponse(r => r.url().endsWith(`/businesses/${id}`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "ثبت تغییر", exact: true }).click();
  expect((await patched).status()).toBe(200);
  await page.getByRole("button", { name: "ثبت شناخت", exact: true }).click();
  await page.getByRole("button", { name: "متوسط", exact: true }).click();
  await page.getByRole("button", { name: "پخش‌کننده", exact: true }).click();
  await page.getByRole("button", { name: "ادامه به سؤال بعد", exact: true }).click();
  await page.getByRole("button", { name: "بعدازظهر · ۱۵ تا ۱۸", exact: true }).click();
  await page.getByPlaceholder("سراغ چه کسی برویم؟").fill("سراغ مدیر");
  const saved = page.waitForResponse(r => r.url().endsWith(`/businesses/${id}/intel`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "ثبت این شناخت", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.locator('[role="dialog"]:not([inert])').waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "ثبت شناخت", exact: true }).waitFor();
  const text = await page.locator("main").innerText();
  for (const value of ["smoke.intel", "ویژه", "سراغ مدیر", "بعدازظهر · ۱۵ تا ۱۸"]) expect(text).toContain(value);
  /* The saved pin renders as a real Leaflet map, expandable into the large dialog. */
  await page.locator(".customer-map .leaflet-marker-icon").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "بزرگ‌نمایی نقشه" }).click();
  await page.getByRole("button", { name: "بستن نقشهٔ بزرگ", exact: true }).click();
  await page.screenshot({ path: "/tmp/rf-crm-profile-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/rf-crm-profile-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
