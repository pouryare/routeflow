import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { startDevServer, BASE } from "./server";
import { sessionCookie } from "./session";

/** Geometric invariants that survive a redesign.
 *
 *  Each one maps to a defect the user found that 1,953 passing vitest cases could not
 *  see, because the suite tests logic and these are rendered output. Text sitting outside
 *  its card, cards too wide for their row, a table bleeding past the card edge — none of
 *  those are visible to a test that never lays anything out.
 *
 *  Deliberately NOT screenshots. This programme changes the design on purpose, so visual
 *  baselines would fail on every intended change until somebody switched them off, and a
 *  disabled ratchet is worse than none. These assertions are true whatever the page ends
 *  up looking like.
 */
let browser: Browser;
let stop: () => Promise<void>;

/** The pages the user's defects were actually on.
 *
 *  /login is deliberately NOT in this list. Its root carries `overflow-hidden`, which
 *  clips any overflowing child, so both geometry rules below are unfalsifiable there — a
 *  4000px probe element passed. A page that cannot fail a test is not a page worth
 *  testing.
 */
const ROUTES = [
  "/sales/dashboard",
  "/sales/products",
  // The old /sales/deliveries and /sales/journey are views of /sales/orders now; a view
  // has no layout of its own, so the host page is the one that is measured.
  "/sales/orders",
  "/sales/reps",
  "/sales/pocket",
  "/sales/academy",
];

/** Viewports the app is actually used at. The two-column and one-column defects the user
 *  reported (items 4 and 6) only appear at a particular width, so a single desktop size
 *  would have missed both. */
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

beforeAll(async () => {
  stop = await startDevServer();
  browser = await chromium.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

async function open(
  route: string,
  viewport: { width: number; height: number },
  /* Map tiles can keep the network busy past networkidle; /map waits for load instead. */
  waitUntil: "networkidle" | "load" = "networkidle",
) {
  const context = await browser.newContext({ locale: "fa-IR", viewport });
  await context.addCookies([{ ...sessionCookie(), url: BASE }]);
  const page = await context.newPage();
  /* 60s, not the 30s default: a dev server compiling a page on first visit while the
     machine is busy can miss 30s without anything being wrong with the page, and a layout
     check that fails on load is one nobody trusts. */
  await page.goto(`${BASE}${route}`, { waitUntil, timeout: 60_000 });

  /* A rejected cookie redirects to /login, which is a perfectly well-laid-out page — so
     every assertion below would pass while testing none of the routes named above. This
     is the difference between a green suite and a working one. */
  const landed = new URL(page.url()).pathname;
  // A route may carry a query («/sales/schedule?view=runs»); only the path is compared.
  if (landed !== route.split("?")[0]) {
    await context.close();
    throw new Error(`${route} redirected to ${landed} — the smoke session was not accepted`);
  }

  /* RevealRoute lifts cards 16px and staggers them, so a box measured mid-entrance sits a
     few pixels off its neighbour: a stat row read as "wrapped" by 5px on a slow run. Wait
     for every finite animation to land; infinite ones (spinners, pulses) never would.
     Only time-based ones: the reveal is also driven by `animation-timeline: view()`, which
     advances as a card scrolls into view. Those never finish for a card below the fold, so
     waiting on them hung every test on any page taller than the viewport. */
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return { page, close: () => context.close() };
}

describe.each(ROUTES)("%s", (route) => {
  describe.each(VIEWPORTS)("at $name", (viewport) => {
    it("actually rendered the page", async () => {
      /* Every assertion below is of the form "nothing is wrong". A blank page satisfies
         all of them, so the suite would report success loudest exactly when the server
         is broken. This is the assertion that has to fail first. */
      const { page, close } = await open(route, viewport);
      const [elements, text] = await page.evaluate(() => [
        document.querySelectorAll("body *").length,
        (document.body.textContent ?? "").trim().length,
      ]);
      await close();
      expect(elements, "the page rendered almost nothing").toBeGreaterThan(20);
      expect(text, "the page has no Persian copy on it").toBeGreaterThan(20);
    }, 90_000);

    it("never scrolls sideways", async () => {
      /* A horizontal scrollbar on an RTL page almost always means a fixed width or a
         negative margin escaping its container — the family behind items 4, 6 and 17. */
      const { page, close } = await open(route, viewport);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      await close();
      expect(overflow, `${route} scrolls ${overflow}px sideways`).toBeLessThanOrEqual(1);
    }, 90_000);

    it("has no element whose content overflows its own box", async () => {
      /* Items 11 and 17: content escaping its card. scrollWidth > clientWidth means the
         box is not big enough for what is inside it. Elements that scroll on purpose
         declare it in overflow-x, and are exempt for exactly that reason. */
      const { page, close } = await open(route, viewport);
      const offenders = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((el) => {
            const s = getComputedStyle(el);
            if (s.overflowX !== "visible" || s.position === "fixed") return false;
            return el.scrollWidth - el.clientWidth > 2;
          })
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} ` +
              `(${el.scrollWidth - el.clientWidth}px over)`,
          ),
      );
      await close();
      expect(offenders, `content is wider than its container:\n${offenders.join("\n")}`).toEqual([]);
    }, 90_000);

    it("keeps every interactive target reachable", async () => {
      /* An RTL layout built with physical `left`/`right` puts things off the wrong edge —
         which is item 2's popover, in a form no unit test can see.

         "Off screen" is not the same as "unreachable", and the first version of this rule
         confused the two: it reported the nav links on every phone-width page, which sit
         in a row the user scrolls sideways on purpose. So an element only counts if it is
         outside the viewport AND no ancestor can scroll it back in. That is the condition
         that actually means "the user cannot get to this". */
      const { page, close } = await open(route, viewport);
      const escaped = await page.evaluate(() => {
        const scrollableAncestor = (el: HTMLElement): boolean => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            const scrolls = /auto|scroll/.test(s.overflowX) || /auto|scroll/.test(s.overflowY);
            if (scrolls && (p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight)) {
              return true;
            }
          }
          return false;
        };
        return Array.from(
          document.querySelectorAll<HTMLElement>("button, a[href], input, select"),
        )
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return false; // not rendered
            if (r.left >= -2 && r.right <= window.innerWidth + 2) return false;
            return !scrollableAncestor(el);
          })
          .map((el) => `${el.tagName.toLowerCase()} «${(el.textContent ?? "").trim().slice(0, 30)}»`);
      });
      await close();
      expect(escaped, `these cannot be reached at all:\n${escaped.join("\n")}`).toEqual([]);
    }, 90_000);
  });
});

describe("header", () => {
  /* Item 1, rendered. The static test proves the markup order; only a browser proves the
     chips and the actions actually share a line at the widths the user works at. */
  it.each([
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1280, height: 800 },
    { name: "small laptop", width: 1024, height: 768 },
  ])("keeps nav and actions on one row at $name", async (viewport) => {
    const { page, close } = await open("/sales/dashboard", viewport);
    const [nav, actions] = await page.evaluate(() =>
      [".chrome .top .seg-groups", ".chrome .top .topright"].map((s) => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        return { mid: r.top + r.height / 2, h: r.height };
      }),
    );
    await close();
    expect(nav.h, "the nav did not render").toBeGreaterThan(0);
    expect(Math.abs(nav.mid - actions.mid), "nav and actions sit on different rows").toBeLessThanOrEqual(4);
  }, 90_000);

  it("every group chip is clearly wider than tall", async () => {
    const { page, close } = await open("/sales/dashboard", { width: 1440, height: 900 });
    const ratios = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".seg-groups .seg-item > a")).map((a) => {
        const r = a.getBoundingClientRect();
        return { label: (a.textContent ?? "").trim(), ratio: r.height / r.width };
      }),
    );
    await close();
    expect(ratios.length).toBeGreaterThan(3);
    /* 0.45 separates the two states: 36/71 = 0.51 was the circle, 30/71 = 0.42 the pill. */
    const round = ratios.filter((r) => r.ratio > 0.45).map((r) => `«${r.label}» ${r.ratio.toFixed(2)}`);
    expect(round, `chips that read as circles:\n${round.join("\n")}`).toEqual([]);
  }, 90_000);
});

describe("search overlay", () => {
  /* Items 9 and 29. The search box was inert: Ctrl-K focused it and nothing else. The
     overlay is one component on every shell page, the map included, so both halves are
     asserted from the same key. Page results are used because they exist for every role,
     which keeps this independent of whichever user the smoke session mints. */
  it.each([
    { route: "/sales/dashboard", wait: "networkidle" as const },
    { route: "/map", wait: "load" as const },
  ])("Ctrl-K opens it full-screen on $route, finds a page, Escape closes it", async ({ route, wait }) => {
    const { page, close } = await open(route, { width: 1440, height: 900 }, wait);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    /* Pressed before hydration the key goes nowhere; /map hydrates well after load. */
    await page.locator(".searchslot[data-ready]").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Control+k");
    const dialog = page.locator('[role="dialog"][aria-label="جستجو"]');
    await dialog.waitFor({ state: "visible", timeout: 5000 }).catch((e) => {
      throw new Error(`${e.message}\npage errors:\n${errors.join("\n")}`);
    });

    const box = await dialog.boundingBox();
    expect(box, "the overlay has no box").not.toBeNull();
    expect(box!.width, "the overlay does not cover the viewport: is it trapped in .chrome?").toBeGreaterThanOrEqual(1439);
    expect(box!.height).toBeGreaterThanOrEqual(899);

    await page.keyboard.type("سفارش");
    await page.locator('a[role="option"][href="/sales/orders"]').waitFor({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await close();
  }, 90_000);
});

describe("layout", () => {
  /* Items 4 and 6. The pocket's four stat tiles came out on two rows because .statrow
     was a three-column grid; the day briefing stacked its short panels one per row across
     the full width. Measured, because only a browser knows where a wrap happens. */
  it.each(["/sales/pocket", "/sales/dashboard", "/sales", "/sales/stock"])(
    "every stat row on %s stays on one line at laptop width",
    async (route) => {
      const { page, close } = await open(route, { width: 1280, height: 800 });
      const broken = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".statrow"))
          .map((row, i) => {
            const tops = Array.from(row.children).map((c) => Math.round(c.getBoundingClientRect().top));
            return { i, n: tops.length, spread: Math.max(...tops) - Math.min(...tops) };
          })
          .filter((r) => r.n > 1 && r.spread > 4),
      );
      await close();
      expect(broken, `stat rows that wrapped: ${JSON.stringify(broken)}`).toEqual([]);
    },
    90_000,
  );

  it("the day briefing puts its panels side by side", async () => {
    const { page, close } = await open("/sales/today", { width: 1440, height: 900 });
    const { panels, columns } = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".briefing-grid > .kblock"));
      return { panels: cards.length, columns: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size };
    });
    await close();
    if (panels >= 2) expect(columns, `${panels} panels in ${columns} column(s)`).toBeGreaterThanOrEqual(2);
  }, 90_000);
});

describe("runs", () => {
  /* Item 16. «بار مسیرها» was one long bar per run; it is now lanes on a shared axis, and
     the whole point of the form is that stop N sits in the same column in every lane. If a
     lane drifts off the axis, the chart silently lies about which van is further along. */
  it("every lane's stops sit on the shared stop axis, on one row", async () => {
    const { page, close } = await open("/sales/schedule?view=runs", { width: 1440, height: 900 });
    const report = await page.evaluate(() => {
      const ticks = Array.from(document.querySelectorAll<HTMLElement>(".mlanes__ticks > li")).map((t) => {
        const r = t.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const lanes = Array.from(document.querySelectorAll<HTMLElement>(".mlanes__lane"));
      const off: string[] = [];
      let dots = 0;
      lanes.forEach((lane, li) => {
        const rects = Array.from(lane.querySelectorAll<HTMLElement>(".mlanes__dot")).map((d) => d.getBoundingClientRect());
        dots += rects.length;
        const mids = rects.map((r) => r.top + r.height / 2);
        if (mids.length && Math.max(...mids) - Math.min(...mids) > 2) off.push(`lane ${li} wraps`);
        rects.forEach((r, k) => {
          const x = r.left + r.width / 2;
          if (ticks[k] === undefined || Math.abs(x - ticks[k]) > 2) off.push(`lane ${li} stop ${k + 1} off the axis`);
        });
      });
      return { lanes: lanes.length, dots, off };
    });
    await close();
    expect(report.off, report.off.join("\n")).toEqual([]);
    /* Honest about an empty day: with no open runs there is nothing to measure, and the
       test says so rather than passing silently. */
    if (report.lanes === 0) console.warn("runs smoke: no open runs in the database, lanes unmeasured");
  }, 90_000);

  it("the driver streak grid is seven days tall in every week", async () => {
    const { page, close } = await open("/sales/schedule?view=runs", { width: 1440, height: 900 });
    const bad = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".streak__week"))
        .map((w) => w.querySelectorAll(".streak__cell").length)
        .filter((n) => n !== 7),
    );
    await close();
    expect(bad).toEqual([]);
  }, 90_000);
});

describe("map", () => {
  /* Item 26: the map was a 100dvh pane under the header and the page card, so the page
     scrolled and the map read as an embedded frame. It now wears the page: the whole
     frame is on screen without scrolling, at desktop and phone widths. */
  it.each([
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ])("the map frame fits the viewport at $name", async (viewport) => {
    const { page, close } = await open("/map", viewport, "load");
    await page.locator(".map-viewport").waitFor({ timeout: 30_000 });
    const r = await page.evaluate(() => {
      const b = document.querySelector(".map-viewport")!.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, h: b.height, vh: window.innerHeight };
    });
    await close();
    expect(r.h, "the map has no height").toBeGreaterThan(300);
    expect(r.bottom, `the map runs ${Math.round(r.bottom - r.vh)}px below the fold`).toBeLessThanOrEqual(r.vh + 1);
  }, 90_000);

  /* Item 27: the sidebar is an instrument panel, not a menu. With nothing selected it
     leads with the worklist for the area on screen; the duplicated nav links are gone,
     and so are the map's own copies of the skin and accent controls the header already
     carries. */
  it("the sidebar leads with the worklist, and repeats no navigation", async () => {
    const { page, close } = await open("/map", { width: 1440, height: 900 }, "load");
    await page.locator(".searchslot[data-ready]").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "باز کردن پنل" }).click();
    await page.locator("#mwork-heading").waitFor({ state: "visible", timeout: 10_000 });
    const found = await page.evaluate(() => ({
      quickLinks: document.body.innerText.includes("لینک‌های سریع"),
      floatingSkin: document.querySelectorAll('.map-viewport > div > .themeToggle').length,
    }));
    await close();
    expect(found.quickLinks, "«لینک‌های سریع» is still in the sidebar").toBe(false);
    expect(found.floatingSkin).toBe(0);
  }, 90_000);
});

describe("order pipeline drag", () => {
  /* Item 22. The board runs on a database SNAPSHOT (tests/smoke/server.ts), so this test
     may create and move a real order without touching production.

     Two defects: the ghost was drawn at a fixed x+14, y-18 from the pointer instead of
     where the card was grabbed («۵ سانت دورتر»), and with no draft orders nothing on the
     board could move while every card still wore the grab cursor. */
  it("a draft dragged to «تأییدشده» follows the grab point and is confirmed", async () => {
    const db = new DatabaseSync(process.env.ROUTEFLOW_DB_PATH!, { readOnly: true });
    const org = (db.prepare("SELECT organization_id AS o FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1").get() as { o: number }).o;
    const line = db
      .prepare(
        `SELECT pp.product_id, pk.id AS packaging_id FROM product_prices pp
           JOIN products p ON p.id = pp.product_id AND p.active = 1 AND p.organization_id = ?
           JOIN packagings pk ON pk.product_id = p.id
          LIMIT 1`,
      )
      .get(org) as { product_id: number; packaging_id: number } | undefined;
    const customer = db.prepare("SELECT id FROM customers WHERE organization_id = ? ORDER BY id LIMIT 1").get(org) as { id: number } | undefined;
    db.close();
    expect(line, "the snapshot has no priced product to order").toBeTruthy();
    expect(customer, "the snapshot has no customer").toBeTruthy();

    const { page, close } = await open("/sales/dashboard", { width: 1440, height: 900 });
    const created = await page.context().request.post(`${BASE}/api/sales/orders`, {
      data: {
        customer_id: customer!.id,
        order_date: new Date().toISOString().slice(0, 10),
        lines: [{ product_id: line!.product_id, packaging_id: line!.packaging_id, packs: 1 }],
      },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const reader = new DatabaseSync(process.env.ROUTEFLOW_DB_PATH!, { readOnly: true });
    const order = reader.prepare("SELECT id, order_no FROM orders ORDER BY id DESC LIMIT 1").get() as { id: number; order_no: string };
    reader.close();

    await page.goto(`${BASE}/sales/orders?view=board`, { waitUntil: "networkidle" });
    await page.locator(".searchslot[data-ready]").waitFor({ timeout: 30_000 });
    const card = page.locator(`[data-stage="draft"] button.task[aria-label*="${order.order_no}"]`);
    await card.waitFor({ timeout: 10_000 });
    const box = (await card.boundingBox())!;
    const target = (await page.locator('[data-stage="confirmed"]').boundingBox())!;
    const grab = { x: box.x + 25, y: box.y + 10 };
    const end = { x: target.x + target.width / 2, y: target.y + 60 };

    const confirmed = page.waitForResponse((r) => r.url().includes(`/api/sales/orders/${order.id}`) && r.request().method() !== "GET", { timeout: 15_000 });
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(grab.x + ((end.x - grab.x) * i) / 10, grab.y + ((end.y - grab.y) * i) / 10);
    const ghost = await page.evaluate(() => {
      const g = Array.from(document.querySelectorAll<HTMLElement>(".task")).find((t) => t.style.position === "fixed");
      return g ? { left: parseFloat(g.style.left), top: parseFloat(g.style.top) } : null;
    });
    await page.mouse.up();
    const res = await confirmed;

    const cursors = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".board.pipe .task:not([data-movable])"))
        .slice(0, 5)
        .map((t) => getComputedStyle(t).cursor),
    );
    await close();

    expect(ghost, "no ghost while dragging").not.toBeNull();
    /* The ghost's own left/top: the pointer minus where the card was grabbed. */
    expect(Math.abs(ghost!.left - (end.x - 25)), "the ghost left the grab point").toBeLessThanOrEqual(2);
    expect(Math.abs(ghost!.top - (end.y - 10)), "the ghost left the grab point").toBeLessThanOrEqual(2);
    expect(res.status(), "the drop did not confirm the order").toBeLessThan(300);
    expect(cursors.filter((c) => c === "grab")).toEqual([]);
  }, 120_000);
});

describe("global services", () => {
  /* Slice N. The app had no not-found page at all: a mistyped address showed the
     framework's bare English default. */
  it("an unknown address gets the themed 404, in Persian, with a clean console", async () => {
    const { page, close } = await open("/sales/dashboard", { width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404|Not Found/i.test(m.text())) errors.push(m.text());
    });
    const res = await page.goto(`${BASE}/this-page-does-not-exist`, { waitUntil: "load" });
    const heading = await page.locator(".statepage__title").textContent();
    await close();
    expect(res?.status()).toBe(404);
    expect(heading ?? "").toMatch(/[؀-ۿ]/);
    expect(errors, errors.join("\n")).toEqual([]);
  }, 90_000);

  /* Items 19/21, the input half: the browser's Gregorian date picker is gone from every
     form; the Shamsi picker stores the same ISO value. */
  it("the date field picks a Shamsi date", async () => {
    const { page, close } = await open("/sales/routing", { width: 1440, height: 900 });
    await page.locator(".searchslot[data-ready]").waitFor({ timeout: 30_000 });
    const field = page.locator(".jdate__field").first();
    await field.click();
    await page.locator(".jdate__pop").waitFor({ state: "visible", timeout: 5000 });
    await page.locator(".jdate__day").nth(9).click();
    const shown = (await field.textContent()) ?? "";
    const native = await page.locator('input[type="date"]').count();
    await close();
    expect(shown).toMatch(/^۱۴[۰-۹]{2}/);
    expect(native).toBe(0);
  }, 90_000);

  /* Login-As, end to end, on the database snapshot: start, see the banner, come back. */
  it("an owner can act as a salesperson and come back", async () => {
    const db = new DatabaseSync(process.env.ROUTEFLOW_DB_PATH!, { readOnly: true });
    const target = db
      .prepare("SELECT id, display_name FROM users WHERE role = 'phone_sales' AND active = 1 ORDER BY id LIMIT 1")
      .get() as { id: number; display_name: string } | undefined;
    db.close();
    expect(target, "the snapshot has no active salesperson").toBeTruthy();

    const { page, close } = await open("/sales/dashboard", { width: 1440, height: 900 });
    const started = await page.context().request.post(`${BASE}/api/admin/impersonate`, { data: { user_id: target!.id } });
    expect(started.status(), await started.text()).toBe(200);

    await page.goto(`${BASE}/sales/pocket`, { waitUntil: "networkidle" });
    const banner = page.locator(".actas");
    await banner.waitFor({ state: "visible", timeout: 10_000 });
    const text = (await banner.textContent()) ?? "";

    await page.getByRole("button", { name: "بازگشت به حساب خودم" }).click();
    await page.waitForURL(/\/sales$/, { timeout: 15_000 });
    await page.locator(".searchslot[data-ready]").waitFor({ timeout: 30_000 });
    const after = await page.locator(".actas").count();
    await close();

    const log = new DatabaseSync(process.env.ROUTEFLOW_DB_PATH!, { readOnly: true });
    const kinds = (log.prepare("SELECT kind FROM events WHERE kind LIKE 'auth.impersonation_%' ORDER BY id").all() as { kind: string }[]).map((r) => r.kind);
    log.close();

    expect(text).toContain(target!.display_name);
    expect(after, "the banner survived «بازگشت»").toBe(0);
    expect(kinds).toEqual(["auth.impersonation_started", "auth.impersonation_ended"]);
  }, 120_000);
});

describe("panels and controls stay where they belong", () => {
  /* Measured in a browser, because each of these was a layout that only a browser gets
     wrong: a Tailwind class that compiles to nothing, a grid that was never declared, a
     one-link menu in its own column, a surface pinned to the wrong palette. */

  it.each([
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ])("the notification panel opens inside the viewport on $name", async (viewport) => {
    // `inset-inline-end-0` is not a Tailwind utility, so the panel had no inline anchor
    // and hung off the left edge of the screen from the bell.
    const { page, close } = await open("/sales", viewport);
    await page.locator('button[aria-label="اعلان‌ها"]').first().click();
    const pane = page.locator('[data-pane="notifications"]');
    await pane.waitFor({ state: "visible", timeout: 10_000 });
    const box = (await pane.boundingBox())!;
    await close();
    expect(box.x, "the panel starts left of the screen").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "the panel ends right of the screen").toBeLessThanOrEqual(viewport.width);
  }, 90_000);

  it("the customer window's close button keeps its icon and label centred", async () => {
    // The orders grid opens پنجرهٔ مشتری from every pocket; the snapshot always has orders.
    // The button reads «بستن مشخصات» beside its icon, so it is the icon and the label TOGETHER
    // that must sit in the middle of the button (an icon-only circle is the one-child case).
    const { page, close } = await open("/sales/orders", { width: 1280, height: 800 });
    const opener = page.locator(".pockets > *").first();
    await opener.waitFor({ state: "visible", timeout: 10_000 });
    await opener.click();
    const x = page.locator('.sheet.on button[aria-label^="بستن"]');
    await x.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(600); // the sheet slides in
    const off = await x.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const kids = Array.from(b.children).map((c) => c.getBoundingClientRect());
      const left = Math.min(...kids.map((k) => k.x));
      const right = Math.max(...kids.map((k) => k.x + k.width));
      const top = Math.min(...kids.map((k) => k.y));
      const bottom = Math.max(...kids.map((k) => k.y + k.height));
      return {
        dx: Math.abs(r.x + r.width / 2 - (left + right) / 2),
        dy: Math.abs(r.y + r.height / 2 - (top + bottom) / 2),
        hasLabel: (b.textContent ?? "").trim().length > 0,
      };
    });
    await close();
    expect(off.hasLabel, "the close button says what it closes").toBe(true);
    expect(off.dx, "content off-centre horizontally").toBeLessThanOrEqual(1);
    expect(off.dy, "content off-centre vertically").toBeLessThanOrEqual(1);
  }, 90_000);

  it.each(ROUTES)("every icon-only button on %s centres its icon", async (route) => {
    const { page, close } = await open(route, { width: 1280, height: 800 });
    const off = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .filter((b) => {
          const kids = Array.from(b.children);
          return kids.length === 1 && kids[0].tagName.toLowerCase() === "svg" && !b.textContent?.trim() && b.offsetParent !== null;
        })
        .map((b) => {
          const r = b.getBoundingClientRect();
          const i = b.firstElementChild!.getBoundingClientRect();
          return {
            label: b.getAttribute("aria-label") ?? b.className,
            dx: Math.round(Math.abs(r.x + r.width / 2 - (i.x + i.width / 2))),
            dy: Math.round(Math.abs(r.y + r.height / 2 - (i.y + i.height / 2))),
          };
        })
        .filter((o) => o.dx > 1 || o.dy > 1),
    );
    await close();
    expect(off, `icon-only buttons whose icon is off-centre: ${JSON.stringify(off)}`).toEqual([]);
  }, 90_000);

  it("/settings/notifications has neither a stray one-link menu nor another section's tabs", async () => {
    const { page, close } = await open("/settings/notifications", { width: 1280, height: 800 });
    const found = await page.evaluate(() => ({
      menu: document.querySelectorAll('nav[aria-label="بخش‌های تنظیمات"]').length,
      tabs: document.querySelectorAll(".phc__tabs").length,
    }));
    await close();
    expect(found.menu, "a settings menu with one link came back").toBe(0);
    expect(found.tabs, "the settings page is wearing another section's tabs").toBe(0);
  }, 90_000);

  it.each(["light", "dark"] as const)("the map follows the %s skin and its sidebar text is readable", async (skin) => {
    const { page, close } = await open("/map", { width: 1440, height: 900 }, "load");
    await page.evaluate((s) => localStorage.setItem("coverage-theme", s), skin);
    await page.reload({ waitUntil: "load", timeout: 60_000 });
    await page.locator("#mwork-heading").waitFor({ state: "visible", timeout: 30_000 });
    const found = await page.evaluate(() => {
      const parse = (c: string): [number, number, number] | null => {
        let m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
        m = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
        return null;
      };
      const transparent = (c: string) => c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el: Element | null): string => {
        for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          if (!transparent(c)) return c;
        }
        return "rgb(255, 255, 255)";
      };
      const side = document.querySelector(".mapside");
      const low: string[] = [];
      if (side) {
        for (const el of Array.from(side.querySelectorAll<HTMLElement>("*"))) {
          const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!own || el.offsetParent === null) continue;
          const fg = parse(getComputedStyle(el).color);
          const bg = parse(bgOf(el));
          if (!fg || !bg) continue;
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < 3) low.push(`${el.textContent!.trim().slice(0, 24)} (${ratio.toFixed(2)})`);
        }
      }
      return {
        ground: document.querySelector(".map-viewport")?.getAttribute("data-ground"),
        hasSide: !!side,
        low: low.slice(0, 12),
      };
    });
    await close();
    expect(found.hasSide, "no .mapside on /map").toBe(true);
    expect(found.ground, `the ${skin} skin opened onto a map of the other ground`).toBe(skin);
    expect(found.low, `sidebar text under 3:1 contrast in the ${skin} skin`).toEqual([]);
  }, 120_000);
});

describe("the customer sheet opens and closes for real", () => {
  /* A transform animation that kept filling after it ended (.route-fade, `both`) made the
     page wrapper the containing block for the fixed sheet. Closed, it sat at the bottom of
     the page instead of below the viewport -- visibly open, with a close button that did
     nothing. Only the geometry shows it. */
  const offscreen = (page: import("playwright").Page) =>
    page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>(".sheet");
      if (!sheet) return null;
      return { on: sheet.classList.contains("on"), top: Math.round(sheet.getBoundingClientRect().top), vh: innerHeight };
    });

  it("the close button on /sales/orders really closes the sheet", async () => {
    const { page, close } = await open("/sales/orders", { width: 1280, height: 800 });
    await page.locator(".pockets > *").first().click();
    const x = page.locator('.sheet.on button[aria-label^="بستن"]');
    await x.waitFor({ state: "visible", timeout: 10_000 });
    // Poll for the slide-in instead of sleeping a fixed time: on a long page under load the
    // transition starts late. A sheet that never reaches the screen (the bug this test exists
    // for: a fixed sheet captured by a transformed card) still fails, after the timeout.
    await expect
      .poll(async () => (await offscreen(page))?.top ?? Infinity, { timeout: 8_000, message: "the open sheet is not on screen" })
      .toBeLessThan(800);
    const opened = await offscreen(page);
    await x.click();
    await expect
      .poll(async () => (await offscreen(page))?.top ?? 0, { timeout: 8_000, message: "after ✕ the sheet is still on the page" })
      .toBeGreaterThanOrEqual(800);
    const closed = await offscreen(page);
    await close();
    expect(opened!.top, "the open sheet is not on screen").toBeLessThan(opened!.vh);
    expect(closed!.on).toBe(false);
    expect(closed!.top, "after ✕ the sheet is still on the page").toBeGreaterThanOrEqual(closed!.vh);
  }, 90_000);
});
