/** Rating tags: short reasons a driver taps after the stars of a lead visit («صاحب مغازه خوش‌برخورد»,
 *  «دسترسی سخت»). The company owner edits both lists (/sales/admin/rating-tags); good stars offer the good
 *  tags, low stars the low ones, a middle score both. Pure, so it is tested without a browser. */

export interface RatingTags {
  good: string[];
  low: string[];
}

export const RATING_TAG_MAX = 12;
export const RATING_TAG_LEN = 30;

export const DEFAULT_RATING_TAGS: RatingTags = {
  good: ["صاحب مغازه خوش‌برخورد", "مشتری زیاد", "جای خوب", "انبار بزرگ"],
  low: ["دسترسی سخت", "جای پارک نیست", "قیمت را نپذیرفت", "فروش کم"],
};

/** One list from the owner's input: trimmed, blanks and repeats dropped. Null when a tag is too long, holds a
 *  comma (the chosen tags travel joined by commas) or the list is too long. */
function cleanList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") return null;
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length > RATING_TAG_LEN || /[,،]/.test(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out.length > RATING_TAG_MAX ? null : out;
}

/** The owner's two lists checked at the trust boundary; null when either is malformed. */
export function parseRatingTags(v: unknown): RatingTags | null {
  if (!v || typeof v !== "object") return null;
  const good = cleanList((v as RatingTags).good);
  const low = cleanList((v as RatingTags).low);
  return good && low ? { good, low } : null;
}

/** The stored column: null (never edited) or anything unreadable falls back to the defaults. */
export function readRatingTags(json: string | null | undefined): RatingTags {
  if (!json) return DEFAULT_RATING_TAGS;
  try {
    return parseRatingTags(JSON.parse(json)) ?? DEFAULT_RATING_TAGS;
  } catch {
    return DEFAULT_RATING_TAGS;
  }
}

/** The tags to offer for a set of stars: 4 or more on average the good ones, 2 or less the low ones,
 *  in between both; nothing before any star is given. */
export function tagsForStars(tags: RatingTags, stars: (number | null | undefined)[]): string[] {
  const given = stars.filter((s): s is number => typeof s === "number" && s > 0);
  if (given.length === 0) return [];
  const avg = given.reduce((a, b) => a + b, 0) / given.length;
  if (avg >= 4) return tags.good;
  if (avg <= 2) return tags.low;
  return [...tags.good, ...tags.low];
}
