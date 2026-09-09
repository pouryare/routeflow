import type { IconName } from "@/components/meridian/icon-map";
/** Scoring a prospect after visiting it.
 *
 *  A list of places you have been to is not the same thing as a list of places worth
 *  going back to, and the status field ("visited", "no answer") only records what
 *  happened, never what you concluded. Walking out of a banquet hall thinking "these
 *  people will order every week" and having nowhere to put that means the thought is
 *  gone by the third stop.
 *
 *  ## Why three criteria and not one
 *
 *  A single "good/bad" star collapses judgements that pull in different directions: the
 *  small café that will certainly buy but buy little, against the big hall that might
 *  never call back but would be worth a month of the café if it did. Kept apart, those
 *  are two different reasons to prioritise a visit and you can see which one you are
 *  acting on.
 *
 *  Three, not five: every extra criterion is another thing to fill in at the kerb, and
 *  a scoring system that is tedious at the moment of use gets filled in as all-threes.
 */

export type LeadCriterion = "potential" | "volume" | "ease";

export interface LeadCriterionMeta {
  key: LeadCriterion;
  label: string;
  /** What a high score means here. Shown next to the stars, because "4 out of 5" is
   *  only meaningful if two people would agree what it is 4 out of. */
  hint: string;
  icon: IconName;
}

export const LEAD_CRITERIA: LeadCriterionMeta[] = [
  {
    key: "potential",
    label: "احتمال خرید",
    hint: "چقدر احتمال دارد از ما خرید کند؟",
    icon: "target",
  },
  {
    key: "volume",
    label: "حجم سفارش",
    hint: "اگر خرید کند، اندازه سفارش‌هایش چقدر است؟",
    icon: "package",
  },
  {
    key: "ease",
    label: "سهولت همکاری",
    hint: "دسترسی، برخورد و تسویه‌حساب چطور بود؟",
    icon: "handshake",
  },
];

export const MAX_STARS = 5;

/** The three scores as stored. Null means "not judged", which is different from zero --
 *  a place you have not been to yet is not a place you rated badly. */
export interface LeadScores {
  rating_potential: number | null;
  rating_volume: number | null;
  rating_ease: number | null;
}

export function scoreOf(row: LeadScores, key: LeadCriterion): number | null {
  if (key === "potential") return row.rating_potential;
  if (key === "volume") return row.rating_volume;
  return row.rating_ease;
}

/** A single number for sorting and for the badge on a row.
 *
 *  The mean of whatever has been filled in, ignoring the blanks -- so rating one
 *  criterion gives a usable figure immediately instead of a number dragged towards zero
 *  by the two you have not answered yet. Null when nothing has been rated at all, which
 *  the UI shows as "unrated" rather than as a score of zero.
 */
export function averageScore(row: LeadScores): number | null {
  const given = LEAD_CRITERIA.map((c) => scoreOf(row, c.key)).filter((v): v is number => v !== null);
  if (given.length === 0) return null;
  return given.reduce((a, b) => a + b, 0) / given.length;
}

/** Valid stored value: a whole number of stars in range, or null to clear it. */
export function isValidStars(v: unknown): v is number | null {
  if (v === null) return true;
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_STARS;
}

/** Column name for a criterion, for the update statement. Kept here so the mapping
 *  between the union and the schema lives in one place. */
export function columnFor(key: LeadCriterion): keyof LeadScores {
  return key === "potential" ? "rating_potential" : key === "volume" ? "rating_volume" : "rating_ease";
}
