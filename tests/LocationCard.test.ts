import { describe, it, expect } from "vitest";
import { averageScore } from "@/lib/leadScore";
import { faNum } from "@/lib/format";

const STATUS_META: Record<string, string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
};

const STATUS_COLOR: Record<string, string> = {
  contacted: "bg-green-500",
  visited: "bg-blue-500",
  no_answer: "bg-red-500",
  declined: "bg-gray-500",
};

function makeLocation(overrides = {}) {
  return {
    id: 1,
    name: "Test Location",
    maps_url: "https://maps.example.com",
    address: "123 Test St",
    lat: 35.7,
    lng: 51.4,
    resolution: "direct",
    status: "contacted",
    rating_potential: 4,
    rating_volume: 3,
    rating_ease: 5,
    created_at: "2026-01-01",
    ...overrides,
  };
}

describe("LocationCard logic", () => {
  it("computes average score correctly", () => {
    const loc = makeLocation({ rating_potential: 4, rating_volume: 3, rating_ease: 5 });
    const avg = averageScore(loc);
    expect(avg).toBe(4);
  });

  it("returns null average when no ratings", () => {
    const loc = makeLocation({ rating_potential: null, rating_volume: null, rating_ease: null });
    const avg = averageScore(loc);
    expect(avg).toBeNull();
  });

  it("returns correct status label", () => {
    const loc = makeLocation({ status: "visited" });
    expect(STATUS_META[loc.status ?? ""]).toBe("بازدید شد");
  });

  it("returns correct status color", () => {
    const loc = makeLocation({ status: "no_answer" });
    expect(STATUS_COLOR[loc.status ?? ""]).toBe("bg-red-500");
  });

  it("returns default color for unknown status", () => {
    const status = "unknown";
    expect(STATUS_COLOR[status] ?? "bg-gray-400").toBe("bg-gray-400");
  });

  it("formats average score as Persian numeral", () => {
    const loc = makeLocation({ rating_potential: 4, rating_volume: 4, rating_ease: 4 });
    const avg = averageScore(loc);
    expect(faNum(Math.round((avg ?? 0) * 10) / 10)).toBe("۴");
  });
});
