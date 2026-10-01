import { describe, it, expect } from "vitest";
import {
  parseAirQuality,
  dayAirBand,
  AIR_BANDS,
  AIR_BAND_LABEL_FA,
} from "@/lib/weather/openMeteoAir";

const hours = (over: Partial<Record<string, unknown>> = {}) => ({
  time: ["2026-10-01T00:00", "2026-10-01T06:00", "2026-10-01T12:00"],
  pm2_5: [30, 45, 12],
  pm10: [40, 60, 20],
  european_aqi: [50, 75, 20],
  ...over,
});

describe("air quality, as parsed for a calendar cell", () => {
  it("returns null for a response that is not the shape it expects", () => {
    expect(parseAirQuality({ nonsense: true })).toBeNull();
    expect(parseAirQuality(null)).toBeNull();
  });

  it("reads the daily MEAN, not the peak", () => {
    // The mean is what "how was the day" means. A peak-hour figure on a calendar cell reads
    // as an accusation about the whole day and is not defensible.
    const day = parseAirQuality(hours())!["2026-10-01"];
    expect(day.pm2_5).toBeCloseTo(29, 0);
    expect(day.peak_pm2_5).toBe(45);
  });

  it("survives an all-null pollutant without producing NaN", () => {
    // pm2_5 all null, but the provider's index for those same hours averages 48, which is
    // Moderate. The plan expected "good" here on the assumption that a null means nothing to
    // band on — but the index is its own measurement and it was present. Asserting "good"
    // would have meant overriding a reading the provider actually made.
    const d = parseAirQuality(hours({ pm2_5: [null, null, null] }))!["2026-10-01"];
    expect(d.pm2_5).toBeNull();
    expect(d.aqi).toBe(48);
    expect(dayAirBand(d)).toBe("moderate");
  });

  it("bands a day and every band has a Persian label", () => {
    for (const band of ["good", "moderate", "poor", "very_poor"] as const) {
      expect(AIR_BAND_LABEL_FA[band], `no Persian label for ${band}`).toBeTruthy();
    }
    expect(AIR_BANDS).toHaveLength(4);
  });

  it("bands on the provider's own INDEX when there is one", () => {
    // Measured against a live Tehran response: european_aqi 75 alongside pm10 of
    // 170 µg/m³, because the European index weights PM2.5 far more heavily. Banding on a
    // flat µg/m³ table would call 170 "very poor" and paint half the year red. The index is
    // what the provider computed and what "how was the air" means, so it wins.
    const d = { pm2_5: 30, pm10: 170, peak_pm2_5: 30, aqi: 75 };
    expect(dayAirBand(d)).toBe("poor");
  });

  it("index bands follow the European scale, not a flat concentration table", () => {
    const b = (aqi: number) => dayAirBand({ pm2_5: null, pm10: null, peak_pm2_5: null, aqi });
    expect(b(20)).toBe("good");   // Fair
    expect(b(45)).toBe("moderate"); // Moderate 40-60
    expect(b(65)).toBe("poor");   // Poor 60-80
    expect(b(90)).toBe("very_poor"); // Very poor 80-100
    expect(b(140)).toBe("very_poor"); // Extremely poor, clamped
  });

  it("falls back to concentration ONLY when there is no index", () => {
    // Dust is a PM10 problem; a van loaded with goods meets PM10 before PM2.5. With no
    // index, the worse of the two still decides — never their average.
    const d = { pm2_5: 5, pm10: 120, peak_pm2_5: 5, aqi: null };
    expect(dayAirBand(d)).toBe("very_poor"); // PM10 120 > 100
    expect(dayAirBand({ ...d, pm10: 5 })).toBe("good");
    expect(dayAirBand({ ...d, pm2_5: 120, pm10: 5 })).toBe("very_poor");
  });

  it("an unparseable day is 'good', never a red cell nobody can explain", () => {
    expect(dayAirBand({ pm2_5: null, pm10: null, peak_pm2_5: null, aqi: null })).toBe("good");
  });

  /* The labelling obligation is the whole reason this task is last. These pin it. */

  it("every band label says it is an ESTIMATE — never an official index", () => {
    // This is CAMS reanalysis: a MODEL. Saying "شاخص رسمی" would be a claim with weight
    // behind it that the data does not carry, and a driver told the air is officially bad
    // when a model said so has been misled.
    for (const band of AIR_BANDS) {
      expect(AIR_BAND_LABEL_FA[band], `${band} must be labelled an estimate`).toContain("تخمین");
      expect(AIR_BAND_LABEL_FA[band], `${band} must not claim official status`)
        .not.toContain("رسمی");
    }
  });

  it("the band labels are Persian-only, with no Arabic or presentation forms", () => {
    for (const [band, label] of Object.entries(AIR_BAND_LABEL_FA)) {
      expect(/[\u0600-\u06FF]/u.test(label), `${band} label has no Persian`).toBe(true);
      expect(/[\u0649\u0643\u064A\u0629\u064B-\u0652]/u.test(label), `${band} has Arabic`).toBe(false);
      expect(/[\uFE70-\uFEFF]/u.test(label), `${band} has a presentation form`).toBe(false);
    }
  });

  it("AIR_BANDS and the label map agree, so a new band cannot be unlabelled", () => {
    expect(Object.keys(AIR_BAND_LABEL_FA).sort()).toEqual([...AIR_BANDS].sort());
  });

  it("the concentration fallback uses PER-POLLUTANT breakpoints, not one shared number", () => {
    // 25 µg/m³ means different things for the two particles: moderate for PM10, already
    // poor for PM2.5. A single shared table cannot express that, which is why the index
    // exists. The fallback approximates it with two tables.
    const mk = (p25: number | null, p10: number | null) =>
      dayAirBand({ pm2_5: p25, pm10: p10, peak_pm2_5: p25, aqi: null });
    expect(mk(5, 5)).toBe("good");
    expect(mk(25, null)).toBe("moderate"); // PM2.5 25 -> moderate
    expect(mk(null, 25)).toBe("good");      // PM10 25 is still fine
    expect(mk(1000, 10)).toBe("very_poor");
  });

  it("a day with ONLY pm10 still bands, rather than being treated as missing", () => {
    expect(dayAirBand({ pm2_5: null, pm10: 90, peak_pm2_5: null, aqi: null })).toBe("poor");
  });

  it("a NaN or non-numeric index falls back instead of banding on garbage", () => {
    expect(dayAirBand({ pm2_5: 30, pm10: 30, peak_pm2_5: 30, aqi: null })).toBe("moderate");
  });

  it("ignores a non-numeric reading rather than poisoning the mean with NaN", () => {
    const d = parseAirQuality(hours({ pm2_5: [30, "x", 12] }))!["2026-10-01"];
    expect(d.pm2_5).toBe(21); // mean of 30 and 12 only
    expect(Number.isNaN(d.pm2_5!)).toBe(false);
  });

  it("splits a multi-day response into one entry per day", () => {
    const two = parseAirQuality({
      time: ["2026-10-01T00:00", "2026-10-01T12:00", "2026-10-02T00:00"],
      pm2_5: [10, 20, 90],
      pm10: [10, 20, 90],
      european_aqi: [20, 20, 120],
    })!;
    expect(Object.keys(two).sort()).toEqual(["2026-10-01", "2026-10-02"]);
    expect(two["2026-10-01"].pm2_5).toBe(15);
    expect(two["2026-10-02"].pm2_5).toBe(90);
    expect(dayAirBand(two["2026-10-02"])).toBe("very_poor");
  });

  it("returns null when hourly.time is present but empty", () => {
    // An empty array would otherwise produce {} — truthy, and read as "we have data".
    const r = parseAirQuality({ time: [], pm2_5: [], pm10: [], european_aqi: [] });
    expect(r).toBeNull();
  });

  it("does not mutate the response it parses", () => {
    const body = hours();
    const before = JSON.stringify(body);
    parseAirQuality(body);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("a day present in `time` survives even when every pollutant is null", () => {
    const out = parseAirQuality(hours({ pm2_5: [null, null, null], pm10: [null, null, null] }))!;
    // aqi is the rounded mean of [50, 75, 20] = 48. The day still EXISTS even though every
    // concentration is null: that is "the provider had no particle readings", not "the day
    // is absent", and the two must not collapse.
    expect(out["2026-10-01"]).toEqual({
      pm2_5: null, pm10: null, peak_pm2_5: null, aqi: 48,
    });
    expect(Object.keys(out)).toEqual(["2026-10-01"]);
  });
});
