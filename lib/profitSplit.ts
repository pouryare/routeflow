/** The arithmetic of the yearly profit split, with no database in it (the queries are in
 *  lib/repo/profitSplit.ts). Whole Toman throughout; every split of a sum goes through
 *  `allocate`, which hands out the remainder so the parts always add up to the whole. */
import { jalaliToIsoDate } from "@/lib/jalali";

/** Split `total` by integer `weights` so the parts sum to `total` exactly (largest remainder, ties to the earlier index). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((t, w) => t + w, 0);
  if (!Number.isInteger(total) || total < 0) throw new RangeError("total must be whole and not negative");
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((t, n) => t + n, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/** First and last ISO day of a Jalali year. */
export function yearBounds(jy: number): { from: string; to: string } {
  const from = jalaliToIsoDate(jy, 1, 1);
  const next = new Date(`${jalaliToIsoDate(jy + 1, 1, 1)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  return { from, to: next.toISOString().slice(0, 10) };
}

export interface ShareSet {
  validFrom: string;
  shares: { partyId: number; percentBp: number }[];
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** Each party's share over [from, to], weighted by the days every set was in force (a set holds until the
 *  next one starts). Returns basis-point-days per party (percentBp × days) and the days covered; a day before
 *  the first set has no shares. */
export function weightedShares(sets: ShareSet[], from: string, to: string): { weights: Map<number, number>; daysCovered: number } {
  const ordered = [...sets].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const weights = new Map<number, number>();
  let daysCovered = 0;
  const end = dayNumber(to);
  for (let i = 0; i < ordered.length; i++) {
    const start = Math.max(dayNumber(ordered[i].validFrom), dayNumber(from));
    const stop = Math.min(i + 1 < ordered.length ? dayNumber(ordered[i + 1].validFrom) - 1 : end, end);
    const days = stop - start + 1;
    if (days <= 0) continue;
    daysCovered += days;
    for (const s of ordered[i].shares) weights.set(s.partyId, (weights.get(s.partyId) ?? 0) + s.percentBp * days);
  }
  return { weights, daysCovered };
}

export interface GroupInput {
  groupId: number;
  /** Profit of the group after its own costs and its part of the shared costs. */
  profitToman: number;
  /** Loss the group still owes the company from earlier years. */
  lossBeforeToman: number;
}

export interface GroupOutcome extends GroupInput {
  repaidToman: number;
  distributableToman: number;
  lossAfterToman: number;
}

/** A group's year: a loss is carried (the company absorbs it); a profit first repays the carried loss, and
 *  only what is left reaches the group's shareholders. */
export function settleGroup(g: GroupInput): GroupOutcome {
  if (g.profitToman <= 0) {
    return { ...g, repaidToman: 0, distributableToman: 0, lossAfterToman: g.lossBeforeToman - g.profitToman };
  }
  const repaid = Math.min(g.profitToman, g.lossBeforeToman);
  return { ...g, repaidToman: repaid, distributableToman: g.profitToman - repaid, lossAfterToman: g.lossBeforeToman - repaid };
}

/** The legal reserve (Commercial Code art. 140): a twentieth of the profit shared out, until the reserve
 *  reaches a tenth of the capital. */
export function legalReserve(distributableToman: number, capitalToman: number, reserveBalanceToman: number): number {
  if (distributableToman <= 0) return 0;
  const room = Math.max(0, Math.floor(capitalToman / 10) - reserveBalanceToman);
  return Math.min(Math.floor(distributableToman / 20), room);
}

/** Overheads left untagged, shared between groups by each group's sales (a group with no sales takes none). */
export function shareOverhead(overheadToman: number, salesByGroup: Map<number, number>): Map<number, number> {
  const ids = [...salesByGroup.keys()];
  const parts = overheadToman >= 0
    ? allocate(overheadToman, ids.map((id) => Math.max(0, salesByGroup.get(id)!)))
    : allocate(-overheadToman, ids.map((id) => Math.max(0, salesByGroup.get(id)!))).map((n) => -n);
  return new Map(ids.map((id, i) => [id, parts[i]]));
}
