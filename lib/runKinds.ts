import type { Role } from "@/lib/roles";
import type { IconName } from "@/components/meridian/icon-map";

/** The three things a driver does in one day.
 *
 *  Not three sections — three KINDS of stop, interleaved in ONE ordered list. A person thinks in
 *  one day: they drive a loop, and each door is either a delivery, a revisit to a customer they
 *  know, or a new place nobody has called on. Presenting them as separate lists makes one loop
 *  look like three errands, which is the exact bug this merge set out to remove. */
export type StopKind = "delivery" | "revisit" | "new";

export interface StopKindSpec {
  kind: StopKind;
  /** A meridian icon name, TYPED as `IconName` rather than `string`.
   *  `IconName` is `keyof typeof ICONS`, so a name that does not exist is a compile error rather
   *  than an invisible icon at runtime. An earlier version typed this `string` and named "store",
   *  which the registry does not have — a test asserting the icon was truthy passed happily while
   *  the driver saw nothing. */
  icon: IconName;
  labelFa: string;
  /** What ONE tap on the card does. Same gesture for all three; different screen follows. */
  tapAction: "complete";
  /** Persian hint shown under the card, so the driver knows what completing it means here. */
  hintFa: string;
}

export const STOP_KINDS: readonly StopKindSpec[] = [
  {
    kind: "delivery",
    icon: "package",
    labelFa: "تحویل",
    tapAction: "complete",
    hintFa: "مبلغ را دریافت کنید",
  },
  {
    kind: "revisit",
    icon: "handshake",
    labelFa: "بازدید مجدد",
    tapAction: "complete",
    hintFa: "نتیجه بازدید را ثبت کنید",
  },
  {
    kind: "new",
    icon: "target",
    labelFa: "موقعیت جدید",
    tapAction: "complete",
    hintFa: "موقعیت را ثبت کنید",
  },
] as const;

/** What the day-split panel may do with a stop that is being read from a table row.
 *
 *  `order_id` is checked for NULL, never for truthiness: a `lead_run_stops` row has no order by
 *  construction, and `order_id` of 0 is falsy, so `stop.order_id ? "delivery" : "revisit"` would
 *  report an ordinary stop as a visit and send the driver to the wrong screen. */
export function kindOfStop(stop: { order_id?: number | null }): StopKind {
  return stop.order_id == null ? "revisit" : "delivery";
}

/** One gesture for all three kinds, per Q29. What differs is the screen that follows. */
export function tapActionFor(): "complete" {
  return "complete";
}

/** Only a delivery earns commission.
 *
 *  Commission is recorded in kilograms delivered (`driverCommissionLedger` gates on
 *  `commission.kg > 0`). A visit earns nothing, so a mixed day legitimately shows a smaller number
 *  than the stop count would suggest — that is the truth, not a display bug. */
export function earnsCommission(kind: StopKind): boolean {
  return kind === "delivery";
}

/** The two roles that drive a van, and who can therefore wear both hats on one day.
 *
 *  A field rep who also delivers is ONE person driving ONE loop. That is the entire premise of
 *  the mixed run: two hats, one vehicle, one manifest. */
export function isVanRoleWithBothHats(role: Role): boolean {
  return role === "delivery_driver" || role === "field_rep";
}