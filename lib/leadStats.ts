/** The lead panels on the sales dashboard (moved from the retired /analytics page): how the
 *  pinned leads stand, how far they have got, and how they were scored.
 *
 *  Pure, so the numbers are tested without rendering. Two things changed on the way over:
 *  the funnel's last step «تبدیل شده» counted the same leads as «بازدید شده» (a conversion
 *  that was only a copy), so it is gone; and the funnel is now cumulative, because the
 *  statuses are exclusive and a visited lead has also been reached. */
import type { LocationStatus, SavedLocationRow } from "./database/types";
import { averageScore } from "./leadScore";

type Row = Pick<SavedLocationRow, "status"> & Parameters<typeof averageScore>[0];

export const LEAD_STATUS_LABEL: Record<LocationStatus | "none", string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
  none: "بدون وضعیت",
};

/** Text-safe tokens (MASTER.md), so the dots and bars follow the skin. */
export const LEAD_STATUS_TONE: Record<LocationStatus | "none", string> = {
  contacted: "var(--info)",
  visited: "var(--good)",
  no_answer: "var(--warn)",
  declined: "var(--crit)",
  none: "var(--neutral)",
};

const ORDER: (LocationStatus | "none")[] = ["visited", "contacted", "no_answer", "declined", "none"];

export interface LeadStats {
  total: number;
  scored: number;
  byStatus: { key: LocationStatus | "none"; count: number }[];
  funnel: { label: string; count: number }[];
  scores: { label: string; count: number }[];
}

export function leadStats(rows: Row[]): LeadStats {
  const count = (k: LocationStatus | "none") => rows.filter((r) => (r.status ?? "none") === k).length;
  const visited = count("visited");
  const reached = visited + count("contacted");

  const buckets = [1, 2, 3, 4, 5].map((stars) => ({
    label: `${stars.toLocaleString("fa-IR")} ستاره`,
    count: rows.filter((r) => {
      const s = averageScore(r);
      return s !== null && Math.round(s) === stars;
    }).length,
  }));

  return {
    total: rows.length,
    scored: rows.filter((r) => averageScore(r) !== null).length,
    byStatus: ORDER.map((key) => ({ key, count: count(key) })).filter((s) => s.count > 0),
    funnel: [
      { label: "همهٔ سرنخ‌ها", count: rows.length },
      { label: "تماس یا بازدید", count: reached },
      { label: "بازدید شده", count: visited },
    ],
    scores: buckets,
  };
}
