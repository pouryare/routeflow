import { describe, it, expect } from "vitest";
import { parseOpenMeteo } from "@/lib/weather/openMeteo";

const PAYLOAD = {
  latitude: 35.7,
  longitude: 51.42,
  daily: {
    time: ["2026-03-01", "2026-03-02"],
    temperature_2m_min: [2.1, -1.4],
    temperature_2m_max: [12.5, 7.8],
    precipitation_probability_max: [80, 20],
    precipitation_sum: [9.2, 0.4],
    snowfall_sum: [0, 1.1],
    wind_speed_10m_max: [18, 24],
    wind_gusts_10m_max: [41, 58],
    weather_code: [63, 71],
  },
};

describe("parseOpenMeteo", () => {
  it("maps each daily entry to a snapshot row rounded to the cell", () => {
    const rows = parseOpenMeteo(PAYLOAD, 35.703, 51.418);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      lat_r: 35.7,
      lng_r: 51.42,
      forecast_date: "2026-03-01",
      temp_max: 12.5,
      precip_prob: 80,
      precip_mm: 9.2,
    });
    expect(rows[1].snow_mm).toBe(1.1);
    expect(rows[1].gust_kmh).toBe(58);
    expect(rows[1].weather_code).toBe(71);
  });

  it("returns [] for a body with no daily block", () => {
    expect(parseOpenMeteo({ latitude: 1 }, 1, 1)).toEqual([]);
    expect(parseOpenMeteo(null, 1, 1)).toEqual([]);
  });
});
