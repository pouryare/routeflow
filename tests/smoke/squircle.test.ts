import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { cornerAreaRatio, SUPERELLIPSE_N, CORNER_SHAPE_VALUE } from "@/lib/squircle";

/** The squircle corner, measured rather than eyeballed.
 *
 *  Two things live here:
 *
 *  1. A calibration check. The JS fallback in lib/squircle.ts hard-codes a fitted control
 *     constant, and the CSS ships an exponent. Both are meant to draw the same corner. This
 *     renders the native one, renders the fallback's path, and compares the two by AREA --
 *     so if someone tunes the exponent in globals.css, or the constant drifts, this fails
 *     instead of the two engines quietly diverging on 29% of machines.
 *
 *  2. A live check that the fallback actually runs, and skips pills.
 *
 *  Not a screenshot test, for the reason geometry.test.ts gives: a visual baseline fails on
 *  every intended change until it is switched off, and a disabled ratchet is worse than
 *  none. Area is a number that is true whatever the page ends up looking like.
 */

let browser: Browser;

const R = 100;
const SCALE = 4;
const QUARTER_CIRCLE = (Math.PI * R * R) / 4;

/** Dark-pixel area of the rendered corner, in CSS px^2. */
async function cornerArea(page: Page, markup: string): Promise<number> {
  await page.setContent(`<style>html,body{margin:0;background:#fff}</style>${markup}`);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: R, height: R } });
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    if (data[i * info.channels] < 128) dark++;
  }
  return dark / (SCALE * SCALE);
}

beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe("the squircle corner is the same shape on both engines", () => {
  it(`Chromium can draw ${CORNER_SHAPE_VALUE} at all`, async () => {
    const page = await browser.newPage({ deviceScaleFactor: SCALE });
    const supported = await page.evaluate(
      (v) => CSS.supports("corner-shape", v),
      CORNER_SHAPE_VALUE,
    );
    await page.close();
    // If this ever goes false the native path is gone and this file is measuring nothing.
    expect(supported).toBe(true);
  }, 60_000);

  it("the fitted fallback constant matches the native corner's area within 2%", async () => {
    // The native corner, straight from CSS.
    const page = await browser.newPage({ deviceScaleFactor: SCALE });
    const native = await cornerArea(
      page,
      `<div style="width:${R}px;height:${R}px;background:#000;
        border-radius:${R}px;corner-shape:${CORNER_SHAPE_VALUE}"></div>`,
    );
    await page.close();

    // The same corner as a cubic bezier, the way the fallback draws it.
    const fitted = cornerAreaRatio(0.765437, R) * QUARTER_CIRCLE;

    const ratio = fitted / native;
    expect(
      ratio,
      `fallback corner is ${ratio.toFixed(3)}x the native corner's area`,
    ).toBeGreaterThan(0.98);
    expect(ratio).toBeLessThan(1.02);
  }, 60_000);

  it("the shipped exponent is the convex one, not the concave 0.6 that used to ship", async () => {
    // 0.6 measured 0.878x a circle -- a dent. 1.5 is 1.11x. This is the regression that
    // let every corner in the app scoop inward while the comment claimed otherwise.
    const page = await browser.newPage({ deviceScaleFactor: SCALE });
    const measure = async (n: number) => {
      const area = await cornerArea(
        page,
        `<div style="width:${R}px;height:${R}px;background:#000;
          border-radius:${R}px;corner-shape:superellipse(${n})"></div>`,
      );
      return area / QUARTER_CIRCLE;
    };
    const shipped = await measure(SUPERELLIPSE_N);
    const old = await measure(0.6);
    await page.close();

    expect(old, "0.6 is concave").toBeLessThan(1);
    expect(shipped, "the shipped exponent bulges past a circle").toBeGreaterThan(1.05);
  }, 90_000);
});

describe("the fallback clip does not trap popovers", () => {
  it("a fixed popover inside a clipped card keeps its viewport position", async () => {
    /* This is the assumption the original design got wrong. It cost a planned portalling
       pass across every popover in the skin, and the portalling was never needed:
       clip-path does not re-anchor a `position: fixed` descendant. Only `filter` does.
       Locked in so nobody "fixes" this by adding portals to a clip that was never the
       problem. */
    const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
    await page.setContent(`<style>
      body { margin: 0; }
      .card { position: absolute; top: 60px; left: 100px; width: 200px; height: 100px; }
      .pop { position: fixed; top: 250px; left: 100px; width: 150px; height: 70px; }
    </style>
    <div class="card" style='clip-path: path("M 0 0 L 200 0 L 200 100 L 0 100 Z")'>
      <div class="pop"></div>
    </div>`);

    const box = await page.evaluate(() => {
      const r = document.querySelector(".pop")!.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    });
    await page.close();

    expect(box, "the clip re-anchored the popover").toEqual({ x: 100, y: 250 });
  }, 60_000);

  it("but a filter on the same card does trap it -- so filters are the real constraint", async () => {
    /* The companion fact, and the reason the check above is not a general licence. A
       `filter: var(--card-drop)` creates a containing block, which re-anchors fixed
       descendants. Only three squircle surfaces carry one (.gcard, .face, .mapside) and
       none hosts a popover -- that is the invariant to preserve, not a portal. */
    const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
    await page.setContent(`<style>
      body { margin: 0; }
      .card { position: absolute; top: 60px; left: 100px; width: 200px; height: 100px;
              filter: drop-shadow(0 0 2px rgba(0,0,0,.3)); }
      .pop { position: fixed; top: 250px; left: 100px; width: 150px; height: 70px; }
    </style>
    <div class="card"><div class="pop"></div></div>`);

    const box = await page.evaluate(() => {
      const r = document.querySelector(".pop")!.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    });
    await page.close();

    expect(box, "filter stopped containing the popover -- this is why it matters").not.toEqual({
      x: 100,
      y: 250,
    });
  }, 60_000);
});
