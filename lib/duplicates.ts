/** Two customer records that look like the same business: which one to keep, and how to say why.
 *  Pure, so the choice is tested without a database. */
export interface DupSide {
  id: number;
  orders: number;
  /** ISO timestamp of the last activity, or "" when none. */
  lastActivity: string;
}

/** The survivor is the record with more history (orders), then the one touched most recently, then
 *  the older one (lower id). Merging into the busier record moves the least data. */
export function chooseSurvivor(a: DupSide, b: DupSide): { keep: DupSide; drop: DupSide } {
  const aWins = a.orders !== b.orders ? a.orders > b.orders : a.lastActivity !== b.lastActivity ? a.lastActivity > b.lastActivity : a.id < b.id;
  return aWins ? { keep: a, drop: b } : { keep: b, drop: a };
}

export const DUP_REASON_LABEL: Record<"phone" | "instagram", string> = {
  phone: "شمارهٔ تماس یکسان",
  instagram: "صفحهٔ اینستاگرام یکسان",
};

/** The order of a pair as stored: the lower id first, so (a,b) and (b,a) are one pair. */
export const pairKey = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
