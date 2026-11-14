/* F81 first slice: for each coming day, the confirmed orders (stops, kilograms, cubic metres) against the limits of the vans that can run.
 * A van whose usual driver is away that day does not count. A limit left empty on a van means «no limit» for that kind.
 * Example: 14 stops tomorrow, 2 vans of 6 stops, one driver away -> room 6 -> over by 8. Warning only, nothing is moved. */
export interface VanLimits { id: number; driverId: number | null; maxStops: number | null; maxWeightKg: number | null; maxVolumeM3: number | null }
export interface DayDemand { stops: number; weightKg: number; volumeM3: number }
export interface DayLoad {
  day: string;
  demand: DayDemand;
  vans: number;
  awayVans: number;
  /** Totals over the vans that can run; null = at least one of them has no limit, or there is no van at all. */
  room: { stops: number | null; weightKg: number | null; volumeM3: number | null };
  status: "ok" | "tight" | "over" | "nolimit";
  /** The first kind that is over (or tight), in words. */
  why: string | null;
}

const sum = (xs: (number | null)[]): number | null => (xs.length === 0 || xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0));
const KINDS = [
  { key: "stops", label: "ایستگاه" },
  { key: "weightKg", label: "کیلوگرم" },
  { key: "volumeM3", label: "متر مکعب" },
] as const;

export function dayLoad(day: string, demand: DayDemand, vans: VanLimits[], awayDriverIds: ReadonlySet<number>): DayLoad {
  const running = vans.filter((v) => v.driverId === null || !awayDriverIds.has(v.driverId));
  const room = { stops: sum(running.map((v) => v.maxStops)), weightKg: sum(running.map((v) => v.maxWeightKg)), volumeM3: sum(running.map((v) => v.maxVolumeM3)) };
  let status: DayLoad["status"] = "ok";
  let why: string | null = null;
  if (demand.stops > 0 && running.length === 0) {
    status = "over";
    why = "هیچ خودرویی آزاد نیست";
  } else if (room.stops === null && room.weightKg === null && room.volumeM3 === null) {
    status = demand.stops > 0 ? "nolimit" : "ok";
  } else {
    for (const k of KINDS) {
      const limit = room[k.key];
      if (limit === null || limit <= 0) continue;
      const used = demand[k.key];
      if (used > limit) { status = "over"; why = `${k.label}: ${Math.round(used)} از ${Math.round(limit)}`; break; }
      if (used >= limit * 0.9) { status = "tight"; why ??= `${k.label}: ${Math.round(used)} از ${Math.round(limit)}`; }
    }
  }
  return { day, demand, vans: running.length, awayVans: vans.length - running.length, room, status, why };
}
