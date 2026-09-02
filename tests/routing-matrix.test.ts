import { describe, it, expect } from "vitest";
import { haversineMatrix, durationMatrixFromKm } from "@/lib/routing/matrix";
import { parseOsrmTable } from "@/lib/routing/osrmMatrix";

describe("haversineMatrix", () => {
  it("is symmetric with a zero diagonal", () => {
    const m = haversineMatrix([
      { lat: 35.7, lng: 51.4 },
      { lat: 35.71, lng: 51.42 },
      { lat: 35.69, lng: 51.39 },
    ]);
    for (let i = 0; i < 3; i++) {
      expect(m[i][i]).toBe(0);
      for (let j = 0; j < 3; j++) expect(m[i][j]).toBeCloseTo(m[j][i], 9);
    }
  });

  it("one degree of latitude is about 111 km", () => {
    const m = haversineMatrix([
      { lat: 35, lng: 51 },
      { lat: 36, lng: 51 },
    ]);
    expect(m[0][1]).toBeGreaterThan(110);
    expect(m[0][1]).toBeLessThan(112);
  });
});

describe("durationMatrixFromKm", () => {
  it("22 km at 22 km/h is 3600 s", () => {
    expect(durationMatrixFromKm([[0, 22], [22, 0]])[0][1]).toBe(3600);
  });
});

describe("parseOsrmTable", () => {
  it("accepts a well-formed table and converts metres to km", () => {
    const t = parseOsrmTable({
      code: "Ok",
      durations: [
        [0, 600],
        [600, 0],
      ],
      distances: [
        [0, 3000],
        [3000, 0],
      ],
    });
    expect(t?.durations_s[0][1]).toBe(600);
    expect(t?.distances_km[0][1]).toBe(3);
  });

  it("rejects a non-Ok code and a ragged matrix", () => {
    expect(parseOsrmTable({ code: "Error" })).toBeNull();
    expect(
      parseOsrmTable({ code: "Ok", durations: [[0, 1], [1]], distances: [[0, 1], [1, 0]] })
    ).toBeNull();
  });
});
