import type { RunDetail } from "@/lib/delivery";

/** The demo rows a page shows while a tutorial runs (plan section 11). Every id is negative or starts
 *  with `demo-`, so nothing here can ever be saved (lib/tutorials/pretend.ts, proxy.ts). Names say
 *  «نمونه» so nobody takes them for a real customer. When a list changes what it shows, its demo set
 *  changes in the same pull request (CLAUDE.md, tutorials rule 3). */

const line = (id: number, product: string, pack: string, packs: number, price: number) => ({
  id,
  product_name: product,
  packaging_name: pack,
  packs_ordered: packs,
  packs_delivered: null,
  unit_price_toman: price,
  unit_cost_toman: Math.round(price * 0.8),
  qty_per_pack: 1,
  kg_per_base_unit: 1,
  total_toman: packs * price,
  kg: packs,
});

const stop = (id: number, name: string, address: string, lines: ReturnType<typeof line>[], sort: number) => ({
  id,
  order_id: id,
  order_no: `نمونه-${-id}`,
  priority: "normal",
  customer_id: id,
  customer_name: name,
  address,
  phone: null,
  lat: null,
  lng: null,
  status: "pending",
  collected_toman: 0,
  sort_order: sort,
  notes: null,
  lines,
  total_toman: lines.reduce((s, l) => s + l.total_toman, 0),
});

const DRIVER_RUN: RunDetail = {
  id: -1,
  driver_user_id: -1,
  driver_name: "نمونه",
  run_date: "2026-01-01",
  status: "IN_PROGRESS",
  stops: [
    stop(-1, "سوپرمارکت نمونه", "خیابان نمونه، پلاک ۱", [line(-11, "برنج نمونه", "کیسهٔ ۱۰ کیلویی", 3, 1_200_000), line(-12, "روغن نمونه", "کارتن ۶ تایی", 2, 900_000)], 1),
    stop(-2, "بقالی نمونهٔ رضایی", "کوچهٔ نمونه، پلاک ۸", [line(-21, "چای نمونه", "بستهٔ ۵۰۰ گرمی", 5, 350_000)], 2),
    stop(-3, "فروشگاه نمونهٔ شمال", "بلوار نمونه، پلاک ۲۲", [line(-31, "قند نمونه", "کارتن ۵ کیلویی", 4, 600_000)], 3),
  ],
  facilities: [],
  remaining: 3,
  to_collect_toman: 0,
  collected_toman: 0,
};
DRIVER_RUN.to_collect_toman = DRIVER_RUN.stops.reduce((s, x) => s + x.total_toman, 0);

/** Set id → { list key → rows }. A list reads its key with useTutorialData. */
export const DEMO_SETS: Record<string, Record<string, unknown>> = {
  "driver-day": { "driver-run": DRIVER_RUN },
};
