/** The van at a customer's door: a sale paid on the spot, and a free sample (VC4, F52).
 *
 *  A door sale is NOT a new kind of order. It is the ordinary chain, run in one go for a person who is
 *  standing there with the goods: create the order, confirm it, put it on today's run, record that the
 *  goods were handed over and what was paid. Every reader of orders, stock, payments, the ledger and
 *  commission therefore sees it the way it sees any delivery. What is new is only the guard in front
 *  (the van must hold what is being sold) and the one transaction around the whole thing.
 *
 *  A sample is NOT an order either: orders feed prices, debts, commission and the churn clock, and a free
 *  sample must touch none of them. It is a row in `samples` and one SAMPLE_OUT movement off the van. */

import { getDb } from "@/lib/db";
import { createOrder, submitOrder, OrderError } from "@/lib/orders";
import { addStop, createRun, recordDelivery, DeliveryError } from "@/lib/delivery";
import { advanceOrder } from "@/lib/repo/orders";
import { costBasisFor } from "@/lib/catalogue";
import { customerDebt } from "@/lib/repo/payments";
import { onHandByProduct, recordMovementsTxn } from "@/lib/repo/stock";
import { vanFacilityFor, vanOnHand } from "@/lib/repo/vanStock";
import { emitEvent } from "@/lib/repo/events";
import { isToman } from "@/lib/money";
import { tehranTodayIso } from "@/lib/jalali";
import { PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { SAMPLE_CONVERT_DAYS } from "@/lib/analysis/metrics";
import { readCatalogue } from "@/lib/catalogue";

export class DoorSaleError extends Error {}

/** What the door-sale screen needs: the goods on this person's van, priced, and what today already holds. */
export interface DoorSaleEntry {
  hasVan: boolean;
  /** One entry per packaging that has at least one whole pack on the van. */
  items: { packaging_id: number; product_id: number; label: string; packs_on_van: number; price_toman: number | null }[];
  today: { sales: number; sold_toman: number; samples: number };
}

/** The packagings a person can sell or give away right now: only goods the van really holds, at most the
 *  whole packs it holds, priced from today's list. A product with no price is offered for samples only
 *  (its price is null and the sale screen leaves it out). */
export async function doorSaleEntry(organizationId: number, userId: number): Promise<DoorSaleEntry> {
  const van = await vanFacilityFor(organizationId, userId);
  if (van === null) return { hasVan: false, items: [], today: { sales: 0, sold_toman: 0, samples: 0 } };
  const held = await onHandByProduct(organizationId, van);
  const catalogue = await readCatalogue(getDb(), organizationId, {});
  const items: DoorSaleEntry["items"] = [];
  for (const p of catalogue) {
    const onVan = held.get(p.id) ?? 0;
    for (const k of p.packagings) {
      const packs = Math.floor(onVan / k.qty_per_pack + 1e-9);
      if (packs >= 1) {
        items.push({ packaging_id: k.id, product_id: p.id, label: `${p.name} · ${k.name}`, packs_on_van: packs, price_toman: k.price_toman });
      }
    }
  }
  return { hasVan: true, items, today: await todaysDoorWork(organizationId, userId) };
}

/** How much this person sold at doors and gave away today (Tehran day). */
async function todaysDoorWork(organizationId: number, userId: number) {
  const db = getDb();
  const day = tehranTodayIso();
  const sold = (await db
    .prepare(
      `SELECT COUNT(DISTINCT o.id) AS n, COALESCE(SUM(l.packs_ordered * l.unit_price_toman), 0) AS t
         FROM orders o JOIN order_lines l ON l.order_id = o.id
        WHERE o.organization_id = ? AND o.created_by = ? AND o.channel = 'driver' AND o.order_date = ?
          AND o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})`
    )
    .get(organizationId, userId, day)) as { n: number; t: number };
  const gave = (await db
    .prepare("SELECT COUNT(*) AS n FROM samples WHERE organization_id = ? AND given_by = ? AND substr(given_at, 1, 10) = ?")
    .get(organizationId, userId, day)) as { n: number };
  return { sales: Number(sold.n), sold_toman: Number(sold.t), samples: Number(gave.n) };
}

export interface DoorLineInput {
  product_id: number;
  packaging_id: number;
  packs: number;
}

/** Whole packs only, and only goods the van holds. Names the product that is short. */
async function assertOnVan(organizationId: number, van: number, lines: DoorLineInput[]): Promise<Map<number, number>> {
  if (lines.length === 0) throw new DoorSaleError("قلمی انتخاب نشده است");
  const db = getDb();
  const baseByProduct = new Map<number, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.packs) || l.packs < 1 || l.packs > 999) throw new DoorSaleError("تعداد بسته باید عدد صحیح و مثبت باشد");
    const pk = (await db
      .prepare("SELECT pk.qty_per_pack, p.name FROM packagings pk JOIN products p ON p.id = pk.product_id WHERE pk.id = ? AND pk.product_id = ? AND p.organization_id = ?")
      .get(l.packaging_id, l.product_id, organizationId)) as { qty_per_pack: number; name: string } | undefined;
    if (!pk) throw new DoorSaleError("کالا یا بسته‌بندی پیدا نشد");
    baseByProduct.set(l.product_id, (baseByProduct.get(l.product_id) ?? 0) + l.packs * pk.qty_per_pack);
  }
  for (const [productId, need] of baseByProduct) {
    const held = await vanOnHand(organizationId, van, productId);
    if (held + 1e-9 < need) {
      const name = ((await db.prepare("SELECT name FROM products WHERE id = ?").get(productId)) as { name: string }).name;
      throw new DoorSaleError(`روی ماشین به‌اندازهٔ کافی «${name}» نیست (${held} موجود، ${need} لازم)`);
    }
  }
  return baseByProduct;
}

export interface DoorSaleInput {
  customer_id: number;
  lines: DoorLineInput[];
  /** Cash handed over now. 0 is a sale on account. */
  collected_toman: number;
  client_uuid?: string | null;
  note?: string | null;
}

export interface DoorSaleResult {
  order_id: number;
  order_no: string;
  total_toman: number;
  collected_toman: number;
  /** Set when the sale could not be handed over: the order exists but waits for someone (credit, approval). */
  held: string | null;
  duplicate?: boolean;
}

async function orderTotal(orderId: number): Promise<number> {
  const row = (await getDb().prepare("SELECT COALESCE(SUM(packs_ordered * unit_price_toman), 0) AS t FROM order_lines WHERE order_id = ?").get(orderId)) as { t: number };
  return Math.round(Number(row.t));
}

const HELD_REASON: Record<string, string> = {
  PENDING_CREDIT: "سفارش به سقف اعتبار مشتری خورد و منتظر تأیید مدیر است. کالا را تحویل ندهید.",
  PENDING_REVIEW: "سفارش منتظر بررسی مدیر است. کالا را تحویل ندهید.",
  ON_HOLD: "سفارش نگه داشته شده است. کالا را تحویل ندهید.",
};

/** Sell from the van, deliver, and take the payment, all or nothing.
 *
 *  The caller has already checked the person may sell to this customer (their group). Everything else is
 *  decided here, in one transaction, so a failure at any step leaves no order, no stop, no movement.
 *  A sale that cannot go through the confirmation (the customer is over their credit limit, or the
 *  company's approval limit) is left as an ordinary waiting order and nothing leaves the van.
 *
 *  shortcut: credit is checked before the cash is counted, so a customer over their limit who pays in full
 *  is still held. Upgrade when the credit check can be told the payment (it would need the order total
 *  net of cash). */
export async function sellAtDoor(
  organizationId: number,
  actor: { id: number; canDrive: boolean },
  input: DoorSaleInput,
): Promise<DoorSaleResult> {
  const db = getDb();
  if (!actor.canDrive) throw new DoorSaleError("فروش در محل فقط برای راننده است؛ سفارش را برای بعد ثبت کنید");
  if (!isToman(input.collected_toman) || input.collected_toman < 0) throw new DoorSaleError("مبلغ دریافتی معتبر نیست");

  if (input.client_uuid) {
    const prior = (await db
      .prepare("SELECT id, order_no, paid_toman, status FROM orders WHERE organization_id = ? AND client_uuid = ?")
      .get(organizationId, input.client_uuid)) as { id: number; order_no: string; paid_toman: number; status: string } | undefined;
    if (prior) {
      return { order_id: prior.id, order_no: prior.order_no, total_toman: await orderTotal(prior.id), collected_toman: prior.paid_toman, held: HELD_REASON[prior.status] ?? null, duplicate: true };
    }
  }

  const van = await vanFacilityFor(organizationId, actor.id);
  if (van === null) throw new DoorSaleError("ماشینی برای شما ثبت نشده است");
  await assertOnVan(organizationId, van, input.lines);

  try {
    return await db.tx(async (): Promise<DoorSaleResult> => {
      const now = new Date().toISOString();
      const made = await createOrder(db, {
        customer_id: input.customer_id,
        order_date: now,
        created_by: actor.id,
        organization_id: organizationId,
        salesperson_user_id: actor.id,
        channel: "driver",
        client_uuid: input.client_uuid ?? null,
        notes: input.note ?? null,
        lines: input.lines.map((l) => ({ product_id: l.product_id, packaging_id: l.packaging_id, packs: l.packs })),
      });

      // The person is at the door with the goods: nobody else reviews this one. Submitting still applies
      // the credit and approval-limit rules; only a clean order is confirmed here.
      const status = await submitOrder(organizationId, made.id, { id: actor.id, role: "system" });
      let current = status;
      if (current === "PENDING_REVIEW") current = await advanceOrder(organizationId, made.id, "passReview", { id: actor.id, role: "system" });
      const total = await orderTotal(made.id);
      if (current !== "CONFIRMED") {
        return { order_id: made.id, order_no: made.order_no, total_toman: total, collected_toman: 0, held: HELD_REASON[current] ?? "سفارش منتظر تأیید است. کالا را تحویل ندهید." };
      }

      // A shop that has paid ahead owes nothing: a negative balance must not shrink what may be taken.
      const owed = Math.max(0, (await customerDebt(organizationId, input.customer_id)).total);
      if (input.collected_toman > total + owed) throw new DoorSaleError("مبلغ دریافتی از بدهی مشتری و مبلغ این فروش بیشتر است");

      const day = tehranTodayIso();
      const run = (await db.prepare("SELECT id FROM delivery_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?").get(actor.id, day, organizationId)) as { id: number } | undefined;
      const runId = run?.id ?? (await createRun(db, { driver_user_id: actor.id, run_date: day, created_by: actor.id, organization_id: organizationId }));
      const last = (await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM delivery_stops WHERE run_id = ?").get(runId)) as { m: number };
      // force: a door sale is a deliberate addition to a route that may already be frozen.
      const stopId = await addStop(db, runId, made.id, Number(last.m) + 1, { force: true });

      const lines = (await db.prepare("SELECT id, packs_ordered FROM order_lines WHERE order_id = ?").all(made.id)) as { id: number; packs_ordered: number }[];
      await recordDelivery(db, stopId, {
        lines: lines.map((l) => ({ line_id: l.id, packs_delivered: l.packs_ordered })),
        collected_toman: input.collected_toman,
        by: actor.id,
        notes: "فروش در محل",
      });
      return { order_id: made.id, order_no: made.order_no, total_toman: total, collected_toman: input.collected_toman, held: null };
    });
  } catch (e) {
    if (e instanceof OrderError || e instanceof DeliveryError) throw new DoorSaleError(e.message);
    throw e;
  }
}

export interface SampleInput {
  customer_id: number;
  lines: DoorLineInput[];
  client_uuid?: string | null;
  note?: string | null;
}

/** Give goods away at the door: one `samples` row per line and one SAMPLE_OUT movement off the van.
 *  All or nothing; the van must hold every line. Returns the ids so the screen can say what was recorded. */
export async function giveSamples(
  organizationId: number,
  actor: { id: number },
  input: SampleInput,
): Promise<{ ids: number[]; duplicate?: boolean }> {
  const db = getDb();
  if (input.note != null && input.note.length > 300) throw new DoorSaleError("یادداشت حداکثر ۳۰۰ نویسه است");
  if (input.client_uuid) {
    const prior = (await db.prepare("SELECT id FROM samples WHERE organization_id = ? AND client_uuid LIKE ?").all(organizationId, `${input.client_uuid}%`)) as { id: number }[];
    if (prior.length > 0) return { ids: prior.map((r) => r.id), duplicate: true };
  }
  const van = await vanFacilityFor(organizationId, actor.id);
  if (van === null) throw new DoorSaleError("ماشینی برای شما ثبت نشده است");
  await assertOnVan(organizationId, van, input.lines);

  return await db.tx(async () => {
    const now = new Date().toISOString();
    const ids: number[] = [];
    let n = 0;
    for (const l of input.lines) {
      const pk = (await db.prepare("SELECT qty_per_pack FROM packagings WHERE id = ?").get(l.packaging_id)) as { qty_per_pack: number };
      const baseQty = l.packs * pk.qty_per_pack;
      const cost = (await costBasisFor(db, l.product_id, l.packaging_id, now))?.cost_toman ?? 0;
      const id = Number(
        (await db
          .prepare(
            `INSERT INTO samples (organization_id, customer_id, product_id, packaging_id, packs, base_qty, unit_cost_toman,
                                  given_by, van_facility_id, note, client_uuid, given_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            organizationId, input.customer_id, l.product_id, l.packaging_id, l.packs, baseQty, Math.round(cost),
            actor.id, van, input.note ?? null,
            // One request can hold several lines, and the uuid is unique per row: suffix it with the line.
            input.client_uuid ? `${input.client_uuid}#${n}` : null,
            now, now,
          )).lastInsertRowid,
      );
      n += 1;
      await recordMovementsTxn(db, organizationId, [
        { facility_id: van, product_id: l.product_id, batch_id: null, base_qty: -baseQty, kind: "SAMPLE_OUT", ref_type: "sample", ref_id: id, occurred_at: now, created_by: actor.id },
      ]);
      await emitEvent(organizationId, { kind: "sample.given", entity_type: "sample", entity_id: id, actor_user_id: actor.id, metadata: { customer_id: input.customer_id, product_id: l.product_id, packs: l.packs } }, db);
      ids.push(id);
    }
    return { ids };
  });
}

export interface SampleReportRow {
  user_id: number;
  rep: string;
  given: number;
  customers: number;
  converted: number;
  cost_toman: number;
}

/** F52 first slice: per person, over the last `days` days, how many samples went out, to how many shops, what
 *  they cost, and how many of those shops bought (a priced order from the same shop within
 *  SAMPLE_CONVERT_DAYS of the sample). One shop sampled twice counts once as a shop. */
export async function sampleReport(organizationId: number, days = 30): Promise<SampleReportRow[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = (await db
    .prepare(
      `SELECT s.given_by AS user_id, u.display_name AS rep, s.customer_id, s.given_at,
              s.packs * s.unit_cost_toman AS cost
         FROM samples s JOIN users u ON u.id = s.given_by
        WHERE s.organization_id = ? AND s.given_at >= ?
        ORDER BY s.given_at`
    )
    .all(organizationId, since)) as { user_id: number; rep: string; customer_id: number; given_at: string; cost: number }[];
  const out = new Map<number, SampleReportRow & { shops: Set<number>; won: Set<number> }>();
  for (const r of rows) {
    const row = out.get(r.user_id) ?? { user_id: r.user_id, rep: r.rep, given: 0, customers: 0, converted: 0, cost_toman: 0, shops: new Set<number>(), won: new Set<number>() };
    row.given += 1;
    row.cost_toman += Math.round(Number(r.cost));
    row.shops.add(r.customer_id);
    if (!row.won.has(r.customer_id)) {
      const until = new Date(Date.parse(r.given_at) + SAMPLE_CONVERT_DAYS * 86_400_000).toISOString().slice(0, 10);
      const bought = await db
        .prepare(
          `SELECT 1 FROM orders WHERE organization_id = ? AND customer_id = ? AND COALESCE(order_type, 'SALE') = 'SALE'
              AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)}) AND order_date > ? AND order_date <= ? LIMIT 1`
        )
        .get(organizationId, r.customer_id, r.given_at.slice(0, 10), until);
      if (bought) row.won.add(r.customer_id);
    }
    out.set(r.user_id, row);
  }
  return [...out.values()].map(({ shops, won, ...row }) => ({ ...row, customers: shops.size, converted: won.size }));
}
