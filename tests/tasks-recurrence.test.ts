import { describe, it, expect } from "vitest";
import { rruleMatches } from "@/lib/tasks/recurrence";

// 1405-06-11 is a Wednesday (چهارشنبه); 1405-06-16 is a Monday; 1405-06-10 a Tuesday.
describe("rruleMatches", () => {
  it("daily always matches", () => {
    expect(rruleMatches("daily", "1405-06-11")).toBe(true);
    expect(rruleMatches("daily", "1405-01-01")).toBe(true);
  });

  it("weekly matches only its weekday", () => {
    expect(rruleMatches("weekly:wed", "1405-06-11")).toBe(true);
    expect(rruleMatches("weekly:mon", "1405-06-16")).toBe(true);
    expect(rruleMatches("weekly:mon", "1405-06-11")).toBe(false);
    expect(rruleMatches("weekly:tue", "1405-06-10")).toBe(true);
  });

  it("monthly matches only its day-of-month", () => {
    expect(rruleMatches("monthly:11", "1405-06-11")).toBe(true);
    expect(rruleMatches("monthly:1", "1405-06-11")).toBe(false);
    expect(rruleMatches("monthly:16", "1405-06-16")).toBe(true);
  });

  it("rejects an out-of-range monthly day", () => {
    expect(rruleMatches("monthly:0", "1405-06-11")).toBe(false);
    expect(rruleMatches("monthly:29", "1405-06-29")).toBe(false);
    expect(rruleMatches("monthly:31", "1405-06-31")).toBe(false);
  });

  it("garbage does not match", () => {
    expect(rruleMatches("", "1405-06-11")).toBe(false);
    expect(rruleMatches("weekly", "1405-06-11")).toBe(false);
    expect(rruleMatches("weekly:funday", "1405-06-11")).toBe(false);
    expect(rruleMatches("yearly", "1405-06-11")).toBe(false);
    expect(rruleMatches("monthly:abc", "1405-06-11")).toBe(false);
  });
});
