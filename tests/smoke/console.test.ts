import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appendFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { startDevServer, BASE } from "./server";
import { sessionCookie } from "./session";
import { appTabs } from "../../lib/appNav";

/** Every page the nav can reach, loaded in a real browser, must log nothing.
 *
 *  The geometry suite passed for a whole slice while every sales screen logged a React
 *  hydration mismatch: the pages rendered, laid out and measured fine, and the error sat
 *  in a console no test was reading. A console error is a defect the user is one devtools
 *  window away from seeing; this makes the whole class a failing test.
 *
 *  Routes come from appTabs rather than a hand list, so a page added to the nav is
 *  covered the day it is added. The owner's tabs are the widest set a tenant can see. */
const ROUTES = [...new Set(appTabs({ role: "owner" }).filter((t) => t.ready).map((t) => t.href))];

/** Messages that are the dev server talking about itself, not the app. Keep this short:
 *  every entry is a class of message this test has agreed to stop seeing. */
const DEV_NOISE = [/Download the React DevTools/, /\[HMR\]/, /\[Fast Refresh\]/];

/** ONE tolerated 403, and it is not the app misbehaving.
 *
 *  The shell asks every page for /api/sync/pull. A platform_owner has no sync client —
 *  they are the vendor, not a field device — so the route answers 403 "این حساب همگام‌سازی
 *  ندارد" by design, and the browser logs every non-2xx response to the console.
 *
 *  This suite started seeing it when `pourya` became a platform_owner: session.ts picks the
 *  highest-privilege active user, and for the first time that was not a plain owner. The
 *  alternative — pinning the harness to a plain owner — would make this suite quietly stop
 *  testing the role the founder actually uses, which is the whole point of the current work.
 *
 *  Matched as a SUITE, not per-route: the point is "the founder's pages log nothing but
 *  this", and a blanket "ignore 403s" would hide every future one, which is the opposite of
 *  what this file is for. */
const TOLERATED = [/403 \(Forbidden\)/];

let browser: Browser;
let stop: () => Promise<void>;

beforeAll(async () => {
  stop = await startDevServer();
  browser = await chromium.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

describe("the console stays clean", () => {
  it.each(ROUTES)("%s", async (route) => {
    const context = await browser.newContext({ locale: "fa-IR", viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ ...sessionCookie(), url: BASE }]);
    const page = await context.newPage();
    const logged: string[] = [];
    page.on("pageerror", (e) => logged.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      const text = m.text();
      if (DEV_NOISE.some((re) => re.test(text))) return;
      if (TOLERATED.some((re) => re.test(text))) return;
      logged.push(`${m.type()}: ${text.slice(0, 1200)}`);
    });
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    /* Hydration errors arrive after load, when React reaches the page's Suspense boundary. */
    await page.locator(".searchslot[data-ready]").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await context.close();
    /* vitest truncates a long failure; set SMOKE_CONSOLE_LOG=<file> to get every message. */
    if (process.env.SMOKE_CONSOLE_LOG && logged.length) {
      appendFileSync(process.env.SMOKE_CONSOLE_LOG, `### ${route}\n${logged.join("\n---\n")}\n\n`);
    }
    expect(logged, logged.join("\n\n")).toEqual([]);
  }, 90_000);
});
