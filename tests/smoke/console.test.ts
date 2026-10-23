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

/** NO tolerated messages.
 *
 * This used to carry ONE entry — a blanket 403 matcher — to excuse the shell asking
 * /api/sync/pull on behalf of a platform_owner, which the route refuses by design. That
 * excuse described a real defect rather than an acceptable state: AppShell mounted
 * <SyncStatus /> for every role, mounting it starts the engine, and the engine's first act
 * is the pull. So the founder's browser asked on every page and was refused every time.
 *
 * components/meridian/SyncIsland.tsx now mounts the client only for a role that has one
 * (`hasSyncClient` in lib/roles.ts), so there is no request and no 403 to tolerate. The
 * blanket is GONE rather than narrowed: a matcher left in place would hide the next 403,
 * which is the opposite of what this file is for. If a future role change reintroduces one,
 * this suite should say so.
 *
 * Not re-run as part of this change — the suite boots a browser and a dev server, which
 * this machine cannot do (see .clinerules/report.md). The removal is safe in the meantime:
 * an empty matcher cannot turn a pass into a fail, only make a failure visible again. */
const TOLERATED: RegExp[] = [];

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
    await context.addCookies([{ ...await sessionCookie(), url: BASE }]);
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
