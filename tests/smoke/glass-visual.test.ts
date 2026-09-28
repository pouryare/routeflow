import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { BASE, startDevServer } from "./server";
import { sessionCookie } from "./session";

/** Visual proof for the Tier 2b scroll-driven entrances and the superellipse corners.
 *
 *  Written because the build compiles, the contrast gate passes and the unit
 *  suite is green — and none of those three can tell you whether a card is
 *  actually invisible at the top of the page, stuck half-faded, or scrubbed
 *  backwards when the reader scrolls up. Those are the three failure modes of
 *  `animation-timeline: view()`, and every one of them ships looking fine in a
 *  terminal.
 *
 *  Each assertion below is a failure mode, not a restatement of the CSS.
 */
let stop: () => Promise<void>;
let browser: Browser;
let ctx: any;
let page: Page;

async function freshPage(reducedMotion: "reduce" | "no-preference" = "no-preference") {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion,
  });
  const cookie = sessionCookie();
  await ctx.addCookies([{ ...cookie, domain: "localhost", path: "/" }]);
  page = await ctx.newPage();
  return page;
}

beforeAll(async () => {
  // Reuse an already-running dev server when one is up. server.ts refuses to
  // adopt one, deliberately: the suite must know the database it is writing to
  // is a snapshot. This test is READ-ONLY, so pointing it at a live server is
  // safe — and it makes the difference between running the check and waiting
  // 180s for a spawn that loses the race with a cold .next/dev.
  const live = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!live) stop = await startDevServer();
  browser = await chromium.launch();
  await freshPage();
}, 240_000);

afterAll(async () => {
  await ctx?.close();
  await browser?.close();
  // Only tear down a server this file started.
  if (stop) await stop();
});

const CARDS_RAW = ".meridian .kblock, .meridian .gcard";
const CARDS = CARDS_RAW;

/** Opacity of the first dozen cards, which is where a stuck reveal shows up. */
const opacities = () =>
  page.$$eval(CARDS, (els) =>
    els.slice(0, 12).map((el) => Number(getComputedStyle(el).opacity)),
  );

/** Scroll the whole page so every card crosses its entry range. */
async function scrollThrough() {
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(600);
}

describe("Tier 2b scroll-driven entrances", () => {
  it("resolves corner-shape and sibling-index() in this browser", async () => {
    await page.goto(`${BASE}/sales/dashboard`, { waitUntil: "networkidle" });
    const support = await page.evaluate(() => ({
      cornerShape: CSS.supports("corner-shape", "superellipse(1.5)"),
      timeline: CSS.supports("animation-timeline", "view()"),
      siblingIndex: CSS.supports("animation-delay", "calc(sibling-index() * 10ms)"),
    }));
    // Recorded, not asserted: engine support is a fact about the browser, not a
    // defect. The assertions below hold either way, which is the point of the
    // @supports gating.
    console.log("SUPPORT " + JSON.stringify(support));
    expect(typeof support.cornerShape).toBe("boolean");
  });

  it("leaves nothing invisible — every card reaches full opacity", async () => {
    await page.goto(`${BASE}/sales/dashboard`, { waitUntil: "networkidle" });
    await scrollThrough();
    const values = await opacities();
    // A card that never crossed its range stays at opacity 0 and the page reads
    // as blank. The time-based entrance could not have had this failure.
    expect(values.filter((o) => o < 0.99), `stuck faded: ${JSON.stringify(values)}`).toEqual([]);
  });

  it("does not un-reveal a card that is still on screen when scrolling up", async () => {
    await page.goto(`${BASE}/sales/dashboard`, { waitUntil: "networkidle" });
    await scrollThrough();
    // Scroll back to a position where the cards are STILL VISIBLE, rather than
    // to the very top. At scroll-top the lower cards are legitimately below the
    // fold and correctly sit at their un-revealed state — asserting on those
    // was a bad test, not a bad animation: the first version of this assertion
    // failed on cards that had never been in view at that scroll offset.
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.5));
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const vh = window.innerHeight;
      return Array.from(document.querySelectorAll(".meridian .kblock, .meridian .gcard"))
        .slice(0, 12)
        .map((el) => {
          const r = el.getBoundingClientRect();
          // FULLY visible, not merely intersecting. A card peeking 40px over the
          // bottom edge is legitimately mid-reveal and asserting on it fails
          // for the right reason at the wrong moment — that was the second
          // version of this test, and it was the TEST that was wrong.
          const fullyVisible = r.top >= 0 && r.bottom <= vh;
          return { fullyVisible, opacity: Number(getComputedStyle(el).opacity) };
        })
        .filter((s) => s.fullyVisible)
        .map((s) => s.opacity);
    });

    // Anything FULLY on screen must be completely revealed. Un-revealing while
    // fully in view is the scroll-jacking bug.
    const faded = state.filter((o) => o < 0.99);
    expect(
      faded,
      `fully-visible cards un-revealed on scroll-up: ${JSON.stringify(state)}`,
    ).toEqual([]);
    // Sanity: the filter must not have quietly selected nothing, or this test
    // passes vacuously — which is exactly how it passed before.
    expect(state.length, "no fully-visible cards found — assertion would be vacuous").toBeGreaterThan(0);
  });

  it("shows no motion at all under prefers-reduced-motion", async () => {
    await freshPage("reduce");
    await page.goto(`${BASE}/sales/dashboard`, { waitUntil: "networkidle" });
    // The load-bearing check. The global `animation-duration: 0.01ms !important`
    // sweep cannot stop a view() timeline — it has no duration to shorten — so
    // this asserts the explicit teardown in globals.css actually landed.
    const running = await page.$$eval(CARDS, (els) =>
      els
        .slice(0, 12)
        .filter((el) => {
          const s = getComputedStyle(el);
          // `animationTimeline` postdates the DOM lib in this TypeScript, so the computed
          // style is read through a narrow local type. Runtime behaviour is unchanged.
          const timeline = (s as CSSStyleDeclaration & { animationTimeline?: string }).animationTimeline;
          return s.animationName !== "none" && timeline !== "auto";
        }).length,
    );
    expect(running, "scroll timelines still running under reduced motion").toBe(0);
  });
});
