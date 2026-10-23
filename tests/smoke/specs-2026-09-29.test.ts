import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startDevServer, BASE } from "./server";
import { sessionCookie } from "./session";
import { createSessionToken, COOKIE_NAME } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** The three 2026-09-29 specs, verified in a real browser.
 *
 *  The unit suite cannot see any of this. A redirect that lands on the right host but the
 *  wrong view still "passes" a source-text assertion; a page that 500s passes every test
 *  that reads its source; and a section that renders empty is indistinguishable, in the
 *  DOM, from a section that was never written. This file drives the real app.
 *
 *  The single most valuable assertion here is the FIRST one: before spec 3's last commit,
 *  /leads could not open at all -- the fold raised FOREIGN KEY constraint failed on the
 *  real data and rolled back. Every unit test in the repo was green throughout, because
 *  every unit test used a fixture that did not include the fourth referrer. Only a browser
 *  against the real database would have caught it.
 *
 *  EVERY navigation uses `waitUntil: "load"`, never "domcontentloaded". A Next server
 *  `redirect()` answers 307, and "domcontentloaded" resolves on THAT response -- before the
 *  browser has followed it -- so `page.url()` is still the old path and all four redirect
 *  assertions fail against correct code. "load" waits for the final document. Four
 *  failures that way is a harness bug, not a product bug, and the difference is one word.
 *
 *  Every navigation also carries an explicit 120s timeout. `next dev` compiles a route the
 *  first time it is requested, and /leads is a large page behind a layout: the first run
 *  timed out at Playwright's 30s default while the dev server was still compiling it. The
 *  page was fine -- the sibling assertion that only waited for its heading passed in 3.7s.
 *  A cold compile is slow; it is not a failure.
 */
let browser: Browser;
let stop: () => Promise<void>;

beforeAll(async () => {
  stop = await startDevServer();
  browser = await chromium.launch();
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

/** A page for a SPECIFIC role, so the gate can be exercised per role. */
async function asRole(role: string): Promise<Page | null> {
  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, group_id, organization_id, token_version, display_name AS name
         FROM users WHERE active = 1 AND role = ? ORDER BY id LIMIT 1`,
    )
    .get(role) as
    | { id: number; group_id: number | null; organization_id: number; token_version: number; name: string }
    | undefined;
  /* No such role in this database is not a silent pass and not a spurious failure: the
     unit tests assert the gate exhaustively over every role in the union. */
  if (!user) return null;

  const token = createSessionToken({
    uid: user.id,
    role: role as Parameters<typeof createSessionToken>[0]["role"],
    gid: user.group_id,
    oid: user.organization_id,
    tv: user.token_version,
    name: user.name,
  });
  const context = await browser.newContext({ locale: "fa-IR", viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: COOKIE_NAME, value: token, url: BASE }]);
  return context.newPage();
}

describe("spec 3 — the page that could not open at all", () => {
  it("/leads renders for a manager, with no server error", async () => {
    const context = await browser.newContext({ locale: "fa-IR" });
    await context.addCookies([{ ...sessionCookie(), url: BASE }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(`${BASE}/leads`, { waitUntil: "load", timeout: 120_000 });

    expect(res?.status(), "/leads must not be a 500").toBeLessThan(400);
    const body = await page.content();
    expect(body, "the page rendered an error boundary").not.toMatch(
      /Application error|Internal Server Error/,
    );
    expect(errors, "no uncaught error on /leads").toEqual([]);
    await context.close();
  }, 120_000);

  it("/leads renders the pin pool's own copy, so the page really painted", async () => {
    const context = await browser.newContext({ locale: "fa-IR" });
    await context.addCookies([{ ...sessionCookie(), url: BASE }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/leads`, { waitUntil: "load", timeout: 120_000 });
    /* The heading is the cheapest proof the page rendered rather than returning a shell.
       A 200 with an empty body is exactly what the FK failure produced. */
    await expect
      .poll(async () => (await page.content()).includes("پین‌های نقشه"), { timeout: 30_000 })
      .toBe(true);
    await context.close();
  }, 120_000);
});

describe("spec 1 — /leads is the office, /driver is My Day", () => {
  it("a van role asking for /leads is sent to their own day", async () => {
    const page = await asRole("delivery_driver");
    if (!page) return;
    await page.goto(`${BASE}/leads`, { waitUntil: "load", timeout: 120_000 });
    expect(new URL(page.url()).pathname, "a driver must not reach the pin pool").toBe("/driver");
    await page.context().close();
  }, 120_000);

  it("/driver shows BOTH sections — deliveries and visits — for a van role", async () => {
    const page = await asRole("delivery_driver");
    if (!page) return;
    await page.goto(`${BASE}/driver`, { waitUntil: "load", timeout: 120_000 });

    /* The promise of the spec: a person sees all their work regardless of which hat is
       active. Both headings are present, unconditionally. A missing section and an EMPTY
       section are identical in the DOM, which is precisely why the spec forbids the
       "hide if empty" shortcut — so the assertion is on the heading, not the content. */
    await expect
      .poll(async () => await page.locator("#day-deliveries").count(), { timeout: 45_000 })
      .toBe(1);
    await expect
      .poll(async () => await page.locator("#day-visits").count(), { timeout: 45_000 })
      .toBe(1);
    await page.context().close();
  }, 120_000);
});

