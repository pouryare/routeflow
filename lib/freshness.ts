/** How old the customer data is.
 *
 *  Everything in this app -- debts, statuses, last-purchase dates, the whole cost-to-serve
 *  analysis -- comes from a spreadsheet that somebody has to remember to import. Nothing
 *  goes visibly wrong when they forget. The map still draws, the figures still add up,
 *  and they are quietly describing last month.
 *
 *  The import panel does show a "last updated" line, but it is inside a fold on one page,
 *  which means it is only seen by someone who already suspected. This turns the same fact
 *  into something you notice without looking for it.
 */

export type FreshnessTier = "fresh" | "ageing" | "stale" | "unknown";

/** A week: long enough that a normal weekly import never trips it, short enough that a
 *  missed one is flagged before it has done any real damage. */
export const AGEING_DAYS = 7;

/** A fortnight. Past this the debt figures are describing a previous billing cycle. */
export const STALE_DAYS = 14;

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  // A timestamp in the future is a clock disagreement between this browser and the
  // server, not data from tomorrow. Treated as current rather than as a negative age.
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function freshnessTier(iso: string | null, now: Date = new Date()): FreshnessTier {
  const days = daysSince(iso, now);
  if (days === null) return "unknown";
  if (days >= STALE_DAYS) return "stale";
  if (days >= AGEING_DAYS) return "ageing";
  return "fresh";
}

/** The newest sync timestamp across a set of rows -- what "the data" as a whole was last
 *  updated. Max rather than min: a single row that failed to update does not make the
 *  whole import old, and the import writes them all in one pass anyway. */
export function newestSync(rows: { synced_at: string | null }[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (!r.synced_at) continue;
    if (best === null || r.synced_at > best) best = r.synced_at;
  }
  return best;
}
