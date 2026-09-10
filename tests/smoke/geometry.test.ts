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

async function open(route: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ locale: "fa-IR", viewport });
  await context.addCookies([{ ...sessionCookie(), url: BASE }]);
  const page = await context.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

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
