import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { leadStats } from "@/lib/leadStats";

const row = (status: string | null, scores: [number | null, number | null, number | null] = [null, null, null]) =>
  ({ status, rating_potential: scores[0], rating_volume: scores[1], rating_ease: scores[2] }) as never;

describe("lead stats for the dashboard", () => {
  const rows = [
    row("visited", [5, 5, 4]),
    row("visited"),
    row("contacted", [2, 2, 2]),
    row("no_answer"),
    row("declined"),
    row(null),
  ];
  const s = leadStats(rows);

  it("the funnel is cumulative and has no step that copies another", () => {
    expect(s.funnel.map((f) => f.count)).toEqual([6, 3, 2]);
    expect(s.funnel.map((f) => f.label)).not.toContain("تبدیل شده");
  });

  it("counts every status, and leaves out the empty ones", () => {
    expect(s.byStatus.reduce((n, b) => n + b.count, 0)).toBe(6);
    expect(s.byStatus.every((b) => b.count > 0)).toBe(true);
  });

  it("buckets the average score in whole stars, with Persian digits in the labels", () => {
    expect(s.scored).toBe(2);
    expect(s.scores.find((b) => b.label === "۵ ستاره")?.count).toBe(1);
    expect(s.scores.find((b) => b.label === "۲ ستاره")?.count).toBe(1);
  });

  it("an empty list gives zeros, not NaN", () => {
    const e = leadStats([]);
    expect(e.total).toBe(0);
    expect(e.funnel.every((f) => f.count === 0)).toBe(true);
  });
});

describe("where the panels live", () => {
  it("the dashboard shows them to the roles /api/locations admits", () => {
    const src = fs.readFileSync("app/(shell)/sales/dashboard/page.tsx", "utf8");
    expect(src).toMatch(/PIN_POOL_ROLES\.includes\(session\.role\) && \(\s*<CollapsibleSection title="سرنخ‌ها"/);
  });

  it("the retired /analytics page is gone", () => {
    expect(fs.existsSync("app/(shell)/analytics")).toBe(false);
  });
});
