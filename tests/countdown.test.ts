import { describe, it, expect } from "vitest";
import {
  startCountdown,
  pauseCountdown,
  resumeCountdown,
  remainingMsAt,
  progressAt,
  isElapsed,
  quantise,
  secondsLeft,
} from "@/lib/countdown";

const T0 = 1_700_000_000_000;

describe("startCountdown", () => {
  it("begins running with the whole duration left", () => {
    const c = startCountdown(9000, T0);
    expect(remainingMsAt(c, T0)).toBe(9000);
    expect(progressAt(c, T0)).toBe(1);
    expect(isElapsed(c, T0)).toBe(false);
  });

  it("treats a non-positive duration as already finished", () => {
    for (const ms of [0, -1]) {
      const c = startCountdown(ms, T0);
      expect(isElapsed(c, T0)).toBe(true);
      expect(progressAt(c, T0)).toBe(0);
    }
  });
});

describe("running", () => {
  it("drains in real time", () => {
    const c = startCountdown(10_000, T0);
    expect(remainingMsAt(c, T0 + 2_500)).toBe(7_500);
    expect(progressAt(c, T0 + 2_500)).toBeCloseTo(0.75, 10);
  });

  it("never reports negative time or progress past the ends", () => {
    const c = startCountdown(1_000, T0);
    expect(remainingMsAt(c, T0 + 60_000)).toBe(0);
    expect(progressAt(c, T0 + 60_000)).toBe(0);
    expect(progressAt(c, T0 - 5_000)).toBe(1);
    expect(isElapsed(c, T0 + 1_000)).toBe(true);
  });
});

describe("pause and resume", () => {
  it("freezes the remaining time while paused", () => {
    const running = startCountdown(9_000, T0);
    const paused = pauseCountdown(running, T0 + 3_000);
    // Six seconds left, and they stay six no matter how long the pointer rests there.
    expect(remainingMsAt(paused, T0 + 3_000)).toBe(6_000);
    expect(remainingMsAt(paused, T0 + 90_000)).toBe(6_000);
    expect(isElapsed(paused, T0 + 90_000)).toBe(false);
  });

  it("resumes from where it stopped, not from where the clock is", () => {
    const c = resumeCountdown(pauseCountdown(startCountdown(9_000, T0), T0 + 3_000), T0 + 50_000);
    expect(remainingMsAt(c, T0 + 50_000)).toBe(6_000);
    expect(remainingMsAt(c, T0 + 52_000)).toBe(4_000);
    expect(isElapsed(c, T0 + 56_000)).toBe(true);
  });

  it("survives several pause/resume rounds without drift", () => {
    let c = startCountdown(10_000, T0);
    c = pauseCountdown(c, T0 + 1_000); // 9000 left
    c = resumeCountdown(c, T0 + 5_000);
    c = pauseCountdown(c, T0 + 6_000); // 8000 left
    c = resumeCountdown(c, T0 + 9_000);
    expect(remainingMsAt(c, T0 + 9_000)).toBe(8_000);
    expect(remainingMsAt(c, T0 + 11_000)).toBe(6_000);
  });

  it("is idempotent in both directions", () => {
    const paused = pauseCountdown(startCountdown(9_000, T0), T0 + 2_000);
    expect(pauseCountdown(paused, T0 + 8_000)).toEqual(paused);

    const running = resumeCountdown(paused, T0 + 8_000);
    expect(resumeCountdown(running, T0 + 12_000)).toEqual(running);
  });

  it("does not resurrect a countdown that already finished", () => {
    const c = resumeCountdown(pauseCountdown(startCountdown(1_000, T0), T0 + 4_000), T0 + 5_000);
    expect(isElapsed(c, T0 + 5_000)).toBe(true);
  });
});

describe("quantise", () => {
  it("rounds up, so the bar is never empty while time remains", () => {
    expect(quantise(0.99, 8)).toBe(1);
    expect(quantise(0.51, 8)).toBe(0.625);
    expect(quantise(0.01, 8)).toBe(0.125);
  });

  it("keeps the ends exact", () => {
    expect(quantise(1, 8)).toBe(1);
    expect(quantise(0, 8)).toBe(0);
  });

  it("refuses a step count that would divide by zero", () => {
    expect(quantise(0.5, 0)).toBe(0.5);
    expect(quantise(0.5, -3)).toBe(0.5);
  });
});

describe("secondsLeft", () => {
  it("rounds up, so '۱ ثانیه' is never announced as zero", () => {
    const c = startCountdown(9_000, T0);
    expect(secondsLeft(c, T0)).toBe(9);
    expect(secondsLeft(c, T0 + 8_200)).toBe(1);
    expect(secondsLeft(c, T0 + 9_000)).toBe(0);
  });
});
