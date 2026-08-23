import { describe, expect, it } from "vitest";
import { LEAD_CRITERIA, averageScore, columnFor, isValidStars, scoreOf } from "@/lib/leadScore";

const blank = { rating_potential: null, rating_volume: null, rating_ease: null };

describe("averageScore", () => {
  it("averages what has been filled in", () => {
    expect(averageScore({ rating_potential: 4, rating_volume: 5, rating_ease: 3 })).toBe(4);
  });

  it("ignores the blanks rather than counting them as zero", () => {
    // Rating one criterion has to give a usable figure immediately. Counting the two
    // unanswered ones as zero would show 1.3 for a place you just called excellent.
    expect(averageScore({ ...blank, rating_potential: 4 })).toBe(4);
  });

  it("is null when nothing has been judged", () => {
    // Distinct from zero: somewhere you have not been is not somewhere you rated badly.
    expect(averageScore(blank)).toBeNull();
  });
});

describe("scoreOf", () => {
  it("reads each criterion", () => {
    const row = { rating_potential: 1, rating_volume: 2, rating_ease: 3 };
    expect(scoreOf(row, "potential")).toBe(1);
    expect(scoreOf(row, "volume")).toBe(2);
    expect(scoreOf(row, "ease")).toBe(3);
  });
});

describe("columnFor", () => {
  it("maps every criterion to a distinct column", () => {
    const cols = LEAD_CRITERIA.map((c) => columnFor(c.key));
    expect(new Set(cols).size).toBe(LEAD_CRITERIA.length);
  });

  it("maps to columns the row type actually has", () => {
    for (const c of LEAD_CRITERIA) expect(blank).toHaveProperty(columnFor(c.key));
  });
});

describe("isValidStars", () => {
  it("accepts whole stars in range, and null to clear", () => {
    expect(isValidStars(1)).toBe(true);
    expect(isValidStars(5)).toBe(true);
    expect(isValidStars(null)).toBe(true);
  });

  it("rejects out-of-range, fractional and non-numeric values", () => {
    expect(isValidStars(0)).toBe(false);
    expect(isValidStars(6)).toBe(false);
    expect(isValidStars(3.5)).toBe(false);
    expect(isValidStars("4")).toBe(false);
    expect(isValidStars(undefined)).toBe(false);
  });
});

describe("LEAD_CRITERIA", () => {
  it("stays small enough to fill in at the kerb", () => {
    // A scoring system that is tedious at the moment of use gets filled in as all-threes.
    expect(LEAD_CRITERIA.length).toBeLessThanOrEqual(3);
  });

  it("gives every criterion a hint, since '4 out of 5' needs saying what of", () => {
    for (const c of LEAD_CRITERIA) expect(c.hint.length).toBeGreaterThan(0);
  });
});
