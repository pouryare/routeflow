/** Why a visit is being made — the four kinds of trip this business actually does.
 *
 *  One list, read by the schedule, the planner and the API, so a value can never be
 *  valid in one place and unknown in the next. The column carries no CHECK constraint
 *  (SQLite cannot ALTER one in), which makes this file the constraint.
 *
 *  Colour is part of the definition rather than a lookup in the component: the whole
 *  point of the schedule is that a day reads as a pattern of colours before it reads as
 *  words, and a second table of colours somewhere else is how the two drift.
 */
export type TripPurpose = "first_visit" | "sample" | "delivery" | "collect";

export interface TripPurposeDef {
  id: TripPurpose;
  label: string;
  /** One glyph, for the rail and the calendar dot. */
  icon: string;
  /** The token pair this purpose paints with: ink on its own soft ground. */
  ink: string;
  soft: string;
  /** The calendar dot's colour — the strong tone, since a 5px dot on a pale fill
   *  disappears. */
  dot: string;
}

export const TRIP_PURPOSES: TripPurposeDef[] = [
  {
    id: "first_visit",
    label: "ویزیت اولیه",
    icon: "◎",
    ink: "var(--sky)",
    soft: "var(--sky-soft)",
    dot: "var(--sky)",
  },
  {
    id: "sample",
    label: "نمونه بردن",
    icon: "❦",
    ink: "var(--plum)",
    soft: "var(--plum-soft)",
    dot: "var(--plum)",
  },
  {
    id: "delivery",
    label: "بار بردن",
    icon: "🚚",
    ink: "var(--sage)",
    soft: "var(--sage-soft)",
    dot: "var(--sage)",
  },
  {
    id: "collect",
    label: "پول گرفتن",
    icon: "₸",
    ink: "var(--amber)",
    soft: "var(--amber-soft)",
    dot: "var(--amber)",
  },
];

export function isTripPurpose(v: unknown): v is TripPurpose {
  return typeof v === "string" && TRIP_PURPOSES.some((p) => p.id === v);
}

/** The definition for a stored value, or null when the row predates the column.
 *
 *  Null is a real answer here — «بدون هدف» — not a reason to fall back to the first
 *  purpose in the list, which would silently relabel every historic visit as a ویزیت
 *  اولیه. */
export function tripPurpose(v: string | null | undefined): TripPurposeDef | null {
  if (!isTripPurpose(v)) return null;
  return TRIP_PURPOSES.find((p) => p.id === v) ?? null;
}
