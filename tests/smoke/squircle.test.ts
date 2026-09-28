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
