import { matchesQuery } from "@/lib/persian";

/** What a person picks most is what they should see first.
 *
 *  A customer picker that opens on an alphabetical list makes everyone type; one that opens on
 *  "the five you use most" makes most people tap. The ranking is deliberately dull: how many
 *  times, then how recently, then the alphabet. History lives on the device (per user and per
 *  kind of thing), because it is a convenience, not a record: losing it only means the list
 *  starts alphabetical again. */
export type History = Record<string, { n: number; last: number }>;

export function record(h: History, id: string, now: number): History {
  const cur = h[id] ?? { n: 0, last: 0 };
  return { ...h, [id]: { n: cur.n + 1, last: now } };
}

/** `items` ranked for display. With a query, only matching items (Persian/Arabic letter and
 *  digit variants count as the same, `lib/persian`), in the same order; an empty query matches
 *  everything. `now` is unused today and kept so a decay can be added without touching callers. */
export function rank<T extends { id: string; label: string }>(
  items: T[],
  h: History,
  q: string,
  _now: number,
  limit = 8,
): T[] {
  void _now;
  return items
    .filter((i) => matchesQuery(i.label, q))
    .sort(
      (a, b) =>
        (h[b.id]?.n ?? 0) - (h[a.id]?.n ?? 0) ||
        (h[b.id]?.last ?? 0) - (h[a.id]?.last ?? 0) ||
        a.label.localeCompare(b.label, "fa"),
    )
    .slice(0, limit);
}

/** The ones to show without being asked: only items actually used before, most used first. A
 *  list of five arbitrary alphabetical names is not "your usual". */
export function usual<T extends { id: string; label: string }>(items: T[], h: History, limit = 5): T[] {
  return rank(items, h, "", 0, items.length)
    .filter((i) => (h[i.id]?.n ?? 0) > 0)
    .slice(0, limit);
}

const key = (userId: number, scope: string) => `recents:${userId}:${scope}`;

export function loadHistory(userId: number, scope: string): History {
  try {
    const raw = JSON.parse(localStorage.getItem(key(userId, scope)) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as History) : {};
  } catch {
    return {};
  }
}

export function saveHistory(userId: number, scope: string, h: History): void {
  try {
    localStorage.setItem(key(userId, scope), JSON.stringify(h));
  } catch {
    /* private mode or full: the ranking just resets next time */
  }
}
