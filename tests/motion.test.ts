import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EASE, DUR, STAGGER, STAGGER_CAP, withReducedMotion, popover, riseIn } from "@/lib/motion";

/** lib/motion.ts restates a subset of MASTER.md "Motion" for framer-motion. These guard
 *  that it stays faithful to the tokens and to the CSS copy in app/globals.css. */
describe("lib/motion", () => {
  it("mirrors MASTER.md curve control points", () => {
    expect(EASE.out).toEqual([0.16, 1, 0.3, 1]);
    expect(EASE.snap).toEqual([0.34, 1.26, 0.64, 1]);
    expect(EASE.pop).toEqual([0.34, 1.56, 0.64, 1]);
    expect(EASE.drop).toEqual([0.22, 1.61, 0.36, 1]);
  });

  it("durations are seconds, ordered, and match the MASTER.md ms values / 1000", () => {
    expect(DUR.fast).toBe(0.12);
    expect(DUR.base).toBe(0.18);
    expect(DUR.slow).toBe(0.3);
    expect(DUR.draw).toBe(0.7);
    expect(DUR.fast).toBeLessThan(DUR.base);
    expect(DUR.base).toBeLessThan(DUR.slow);
    expect(DUR.slow).toBeLessThan(1);
  });

  it("DUR.panel is the shared panel duration, and the popover exit is not DUR.fast", () => {
    /* 400ms, in seconds. Shared by the framer panels here and --dur-panel in the CSS
       copy, which the chrome also reads -- that mirror is the whole reason the value
       lives in a token rather than inline. */
    expect(DUR.panel).toBe(0.4);
    /* The exit used to be DUR.fast (0.12), a 120ms dismissal against a 300ms enter.
       An asymmetric dismissal reads as the panel being flung away. */
    expect(popover.exit.transition.duration).not.toBe(DUR.fast);
    expect(popover.exit.transition.duration).toBe(0.2);
    /* And it must not overshoot: a dismissal that bounces reads as a panel that has
       not left yet. EASE.out peaks at exactly 100%. */
    expect(popover.exit.transition.ease).toEqual(EASE.out);
  });

  it("staggers match MASTER.md and the cap is ten", () => {
    expect(STAGGER.tight).toBe(0.02);
    expect(STAGGER.base).toBe(0.04);
    expect(STAGGER.loose).toBe(0.06);
    expect(STAGGER_CAP).toBe(10);
  });

  it("withReducedMotion collapses to an instant transition only when reduced", () => {
    const t = { duration: DUR.slow, ease: EASE.out };
    expect(withReducedMotion(t, true)).toEqual({ duration: 0 });
    expect(withReducedMotion(t, false)).toBe(t);
  });

  it("the popover preset travels far enough to read as a move, not a fade", () => {
    /* 4px was indistinguishable from a cross-fade. The travel is the whole point of
       the preset: on a 10px rise, spring-pop's ~13% peak is a 1px whisper, which is
       the "arrives, kisses past, settles" read. See MASTER.md "Motion". */
    expect(popover.initial.opacity).toBe(0);
    expect(popover.initial.y).toBe(-10);
    expect(popover.animate.opacity).toBe(1);
    expect(popover.animate.y).toBe(0);
    expect(riseIn.hidden.opacity).toBe(0);
    expect(riseIn.hidden.y).toBe(16);
    expect(riseIn.show.opacity).toBe(1);
  });

  it("the --ease-out control points also appear in the globals.css CSS copy", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("cubic-bezier(0.16, 1, 0.3, 1)");
  });
});
