import { describe, it, expect } from "vitest";
import { AIR_BAND_LABEL_FA, AIR_BANDS } from "@/lib/weather/openMeteoAir";
import fs from "node:fs";

describe("the air-quality attribution the data owes", () => {
  it("the schedule page says where the data comes from and that it is a model", () => {
    const src = fs.readFileSync("app/(shell)/sales/schedule/page.tsx", "utf8");
    // Open-Meteo's API data is CC BY 4.0, so the credit is owed.
    expect(src).toContain("Open-Meteo");
    // And the one rule: this is CAMS reanalysis, never an official index.
    expect(src).toContain("تخمین مدل");
    // The page says «نه شاخص رسمی» — "NOT an official index". That is the disclaimer doing
    // its job, so the word is allowed there and the ban is on AFFIRMING it. Checking a
    // bare `not.toContain` flagged the very sentence that protects the reader.
    expect(src).toContain("نه شاخص رسمی");
    const affirmations = src.split("شاخص رسمی").slice(0, -1)
      .filter((chunk) => !chunk.trimEnd().endsWith("نه"));
    expect(affirmations, "the page must never claim an official index").toEqual([]);
  });

  it("the board renders an air band with a TEXT label, not a colour alone", () => {
    const src = fs.readFileSync("components/meridian/ScheduleBoard.tsx", "utf8");
    expect(src).toContain("AIR_BAND_LABEL_FA");
  });

  it("no band label claims official status", () => {
    for (const b of AIR_BANDS) {
      expect(AIR_BAND_LABEL_FA[b]).toContain("تخمین");
      expect(AIR_BAND_LABEL_FA[b]).not.toContain("رسمی");
    }
  });
});
