import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
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
  "/sales/deliveries",
  "/sales/reps",
  "/sales/pocket",
  "/sales/journey",
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
  await page.goto(`${BASE}${route}`, { waitUntil });

  /* A rejected cookie redirects to /login, which is a perfectly well-laid-out page — so
     every assertion below would pass while testing none of the routes named above. This
     is the difference between a green suite and a working one. */
  const landed = new URL(page.url()).pathname;
  if (landed !== route) {
    await context.close();
    throw new Error(`${route} redirected to ${landed} — the smoke session was not accepted`);
  }
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
