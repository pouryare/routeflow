/** Customers pinned to real محله, map pins, and the lapsed cohort churn needs.
 *
 *  The lapsed group is the one that is easy to miss and impossible to retrofit. Without ~30
 *  customers who ordered and then went quiet for 60 days, `trainChurnFromLapses` returns
 *  `{trained: false}` (lib/repo/churn.ts:24, MIN_TRAIN_ROWS = 10) and /analytics has no churn
 *  column. The silence has to exist in the ORDER history, which phase 05 owns — so this phase
 *  RECORDS which ids must lapse, and phase 05 honours it. They are taken from the FRONT of
 *  the customer list, so it is the same 30 every run.
 */

import { faDigits } from "@/lib/format";
import type { SeedContext } from "../context";

const TYPES = ["RESTAURANT", "HOTEL", "CATERING", "CAFE", "RETAIL", "WHOLESALE"] as const;

/** Iranian business-name shapes. Combined these read like a real customer list rather than
 *  "مشتری ۱" — a name column full of placeholders is the fastest way to spot fake data. */
const PREFIX = ["رستوران", "هتل", "کافه", "فروشگاه", "پخش", "تأمین", "بازرگانی", "سوپر"];
const MIDDLE = ["شیرین", "پارس", "سپهر", "آریا", "البرز", "کیان", "نیلوفر", "زاگرس", "باران", "مریم"];
const SUFFIX = ["۱", "۲", "۳", "پارس", "نو", "غرب", "شرق", "مرکزی"];
const SURNAME = ["احمدی", "کریمی", "رضایی", "رستمی", "موسوی", "حسینی", "قاسمی"];

/** Iranian mobile prefixes — a 0912… that fails validation looks like a bug. */
const MOBILES = ["0912", "0913", "0919", "0935", "0936"];

export function run(ctx: SeedContext): void {
  const { db, rng } = ctx;
  const now = ctx.stamp(0);

  /* Snap to real محله so every pin has a district and a coordinate. A fresh database has no
     districts at all, which is why phase 02 must run first. */
  const mahalle = db
    .prepare(
      `SELECT id, name, centroid_lat AS lat, centroid_lng AS lng
         FROM districts WHERE level = 'mahalle' AND centroid_lat IS NOT NULL`,
    )
    .all() as { id: number; name: string; lat: number; lng: number }[];
  if (mahalle.length === 0) throw new Error("phase 02 must run first — no محله to snap to");

  /* Jitter a pin inside its own محله, so pins spread across a district instead of stacking on
     one pixel. The bounds are roughly one محله across. */
  const jitter = (d: { lat: number; lng: number }) => ({
    lat: d.lat + rng.next() * 0.012 - 0.006,
    lng: d.lng + rng.next() * 0.016 - 0.008,
  });

  /* Every column is bound, including the handful that are always the same value. Mixing
     literals into a 27-column INSERT is how the placeholder count drifts out of step with
     the argument list, and SQLite's error for that ("column index out of range") does not
     say which. */
  const insCustomer = db.prepare(
    `INSERT INTO customers (customer_code, business_name, contact_person, phone, address,
                            city, province, lat, lng, lifecycle, customer_type, district_id,
                            area_label, synced_at, group_id, organization_id, owner_user_id,
                            payment_terms_days, rating_potential, rating_volume, rating_ease,
                            source_code, credit_limit_toman, size_band, price_tier,
                            verification, contact_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const groups = ctx.ids.groupIds!;
  const sellers = [ctx.staff.phone_sales, ctx.staff.field_rep, ctx.staff.rep_manager];
  const customerIds: number[] = [];

  for (let i = 0; i < ctx.scale.customers; i++) {
    const d = rng.pick(mahalle);
    const point = jitter(d);
    const terms = rng.pick([0, 14, 30, 45]);

    customerIds.push(
      Number(
        insCustomer.run(
          `DEMO-C${faDigits(String(i + 1).padStart(4, "0"))}`,
          `${rng.pick(PREFIX)} ${rng.pick(MIDDLE)} ${rng.pick(SUFFIX)}`,
          `${rng.pick(MIDDLE)} ${rng.pick(SURNAME)}`,
          `${rng.pick(MOBILES)}${rng.int(1000000, 9999999)}`,
          `تهران، ${d.name}`,
          "تهران",
          "تهران",
          point.lat,
          point.lng,
          "active",
          rng.pick(TYPES),
          d.id,
          d.name,
          now,
          rng.pick(groups),
          ctx.orgId,
          rng.pick(sellers),
          terms,
          rng.int(1, 5),
          rng.int(1, 5),
          rng.int(1, 5),
          "demo",
          /* Credit limit scaled to the payment terms: 45-day terms get a bigger line. */
          terms * rng.int(3_000_000, 12_000_000) + rng.int(10_000_000, 60_000_000),
          rng.pick(["small", "medium", "large"] as const),
          rng.pick(["A", "B", "C"] as const),
          "verified",
          "open",
        ).lastInsertRowid,
      ),
    );
  }
  ctx.ids.customerIds = customerIds;

  /* The lapsed cohort. Phase 04 RECORDS the ids here; phase 05 marks them dormant AFTER it
   * has generated their history — asserting it before the orders exist does not survive the
   * order path, and being dormant is a consequence of the silence, not a precondition. */
  ctx.ids.lapsedCustomerIds = customerIds.slice(0, ctx.scale.lapsedCustomers);

  /* Map pins. `maps_url` is UNIQUE (organization_id, maps_url), so it is part of the key —
     a per-index URL is both unique and stable, unlike a real Maps link which would encode a
     place id we do not have. */
  const insPin = db.prepare(
    `INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, created_at,
                                  status, updated_at, group_id, organization_id,
                                  rating_potential, rating_volume, rating_ease)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, 'new', ?, ?, ?, ?, ?, ?)`,
  );
  const pinIds: number[] = [];
  for (let i = 0; i < ctx.scale.leads; i++) {
    const d = rng.pick(mahalle);
    const point = jitter(d);
    pinIds.push(
      Number(
        insPin.run(
          `${rng.pick(PREFIX)} ${rng.pick(MIDDLE)} ${rng.pick(SUFFIX)}`,
          `https://maps.google.com/maps?cid=demo-lead-${ctx.orgId}-${i + 1}`,
          `تهران، ${d.name}`,
          point.lat,
          point.lng,
          now,
          now,
          rng.pick(groups),
          ctx.orgId,
          rng.int(1, 5),
          rng.int(1, 5),
          rng.int(1, 5),
        ).lastInsertRowid,
      ),
    );
  }
  ctx.ids.leadLocationIds = pinIds;

  /* Lead rows in the CRM's own lifecycle, so the funnel's first stage is populated. They are
     NOT in `customerIds`: phase 05 orders only against active customers, and a lead is by
     definition not one yet. */
  for (let i = 0; i < ctx.scale.leads; i++) {
    const d = rng.pick(mahalle);
    const point = jitter(d);
    insCustomer.run(
      `DEMO-L${faDigits(String(i + 1).padStart(4, "0"))}`,
      `${PREFIX[i % PREFIX.length]} ${MIDDLE[i % MIDDLE.length]} ${SUFFIX[i % SUFFIX.length]}`,
      null,
      null,
      `تهران، ${d.name}`,
      "تهران",
      "تهران",
      point.lat,
      point.lng,
      rng.pick(["lead", "lead", "qualified", "sampled"] as const),
      rng.pick(TYPES),
      d.id,
      d.name,
      now,
      rng.pick(groups),
      ctx.orgId,
      rng.pick(sellers),
      0,
      rng.int(1, 5),
      rng.int(1, 5),
      rng.int(1, 5),
      "demo",
      null,
      null,
      null,
      "unverified",
      "new",
    );
  }

  ctx.progress(
    `${customerIds.length} customers (${ctx.ids.lapsedCustomerIds.length} lapsed), ${pinIds.length} pins, ` +
      `${ctx.scale.leads} leads`,
  );
}
