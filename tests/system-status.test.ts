import { describe, it, expect } from "vitest";
import { statusLines, type StatusFacts } from "@/lib/systemStatus";

const NOW = new Date("2026-10-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const facts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  backup: { ok: true, finishedAt: hoursAgo(5), database: { file: "x.db", bytes: 2_097_152, check: "ok" }, photos: null, error: null },
  analysisAt: hoursAgo(5),
  forecastAt: hoursAgo(5),
  lastSyncAt: hoursAgo(1),
  customersSyncedAt: hoursAgo(24),
  lastNotificationAt: hoursAgo(2),
  failedSignIns24h: 0,
  dbBytes: 1_048_576,
  ...over,
});

const tone = (f: StatusFacts, key: string) => statusLines(f, NOW).find((l) => l.key === key)!.tone;

describe("statusLines", () => {
  it("is all good on a healthy day", () => {
    expect(statusLines(facts(), NOW).every((l) => l.tone === "good")).toBe(true);
  });

  it("flags a missing, failed or old backup", () => {
    expect(tone(facts({ backup: null }), "backup")).toBe("unknown");
    expect(tone(facts({ backup: { ...facts().backup!, ok: false, error: "disk full" } }), "backup")).toBe("bad");
    expect(tone(facts({ backup: { ...facts().backup!, finishedAt: hoursAgo(36) } }), "backup")).toBe("warn");
    expect(tone(facts({ backup: { ...facts().backup!, finishedAt: hoursAgo(50) } }), "backup")).toBe("bad");
  });

  it("flags stale nightly jobs and many failed sign-ins", () => {
    expect(tone(facts({ analysisAt: hoursAgo(80) }), "analysis")).toBe("bad");
    expect(tone(facts({ forecastAt: null }), "forecast")).toBe("unknown");
    expect(tone(facts({ failedSignIns24h: 6 }), "signins")).toBe("warn");
    expect(tone(facts({ failedSignIns24h: 25 }), "signins")).toBe("bad");
  });

  it("never calls a quiet sync day broken on its own", () => {
    expect(tone(facts({ lastSyncAt: hoursAgo(500) }), "sync")).toBe("warn");
  });
});
