import type { Db } from "@/lib/database/client";
import { makeRepo } from "./base";
import { isDayWithin, isQuantity } from "@/lib/inputChecks";
import { isToman } from "@/lib/money";
import {
  BATCH_TRANSITIONS,
  canTransitionBatch,
  type BatchStatus,
} from "@/lib/batchStates";

/** A refusal the caller shows the user, not a bug. */
export class BatchError extends Error {}

export interface BatchRow {
  id: number;
  organization_id: number;
  product_id: number;
  batch_code: string;
  supplier_batch_ref: string | null;
  purchase_line_id: number | null;
  produced_at: string | null;
  expiry_date: string | null;
  qty_received_base: number;
  unit_cost_toman: number;
  status: BatchStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const batchesRepo = makeRepo<BatchRow>("batches", { tenant: true });

export interface CreateBatchInput {
  product_id: number;
  batch_code?: string | null;
  supplier_batch_ref?: string | null;
  purchase_line_id?: number | null;
  produced_at?: string | null;
  expiry_date?: string | null;
  qty_received_base: number;
  unit_cost_toman?: number | null;
  notes?: string | null;
}

function ymd(iso: string): string {
  return iso.slice(2, 10).replace(/-/g, ""); // 2026-09-02 -> 260902
}

/** Insert a batch inside a transaction the caller already owns. Auto-codes as
 *  `<YYMMDD>-<n>` per (org, product, date) when no code is given; defaults `expiry_date`
 *  to `produced_at + products.shelf_life_days` when both are known. */
export async function createBatchTxn(
  db: Db,
  organizationId: number,
  input: CreateBatchInput
): Promise<number> {
  if (!(input.qty_received_base > 0)) {
    throw new BatchError("مقدار دریافتی سری ساخت باید بزرگ‌تر از صفر باشد");
  }
  if (!isQuantity(input.qty_received_base, 1_000_000_000)) {
    throw new BatchError("مقدار دریافتی سری ساخت معتبر نیست");
  }
  if (input.unit_cost_toman != null && (!isToman(input.unit_cost_toman) || input.unit_cost_toman < 0)) {
    throw new BatchError("بهای هر واحد باید عدد صحیح تومان و غیرمنفی باشد");
  }
  if (input.produced_at != null && !isDayWithin(input.produced_at, 5 * 366, 1)) {
    throw new BatchError("تاریخ تولید معتبر نیست");
  }
  if (input.expiry_date != null && !isDayWithin(input.expiry_date, 20 * 366, 100 * 366)) {
    throw new BatchError("تاریخ انقضا معتبر نیست");
  }
  if (input.produced_at && input.expiry_date && input.expiry_date.slice(0, 10) < input.produced_at.slice(0, 10)) {
    throw new BatchError("تاریخ انقضا نمی‌تواند پیش از تاریخ تولید باشد");
  }
  if (input.batch_code != null && input.batch_code.trim().length > 60) {
    throw new BatchError("کد سری ساخت حداکثر ۶۰ نویسه است");
  }
  if (!await db.prepare("SELECT 1 FROM products WHERE id = ? AND organization_id = ?").get(input.product_id, organizationId)) {
    throw new BatchError("کالا پیدا نشد");
  }
  const now = new Date().toISOString();
  const producedAt = input.produced_at ?? null;

  let expiry = input.expiry_date ?? null;
  if (!expiry && producedAt) {
    const shelf = await db
      .prepare("SELECT shelf_life_days FROM products WHERE id = ?")
      .get(input.product_id) as { shelf_life_days: number | null } | undefined;
    if (shelf?.shelf_life_days && shelf.shelf_life_days > 0) {
      expiry = (
        await db
          .prepare("SELECT date(?, ?) AS d")
          .get(producedAt.slice(0, 10), `+${shelf.shelf_life_days} days`) as { d: string }
      ).d;
    }
  }

  let code = input.batch_code?.trim() || null;
  if (!code) {
    const prefix = ymd(producedAt ?? now);
    const n =
      Number(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM batches WHERE organization_id = ? AND product_id = ? AND batch_code LIKE ?"
            )
            .get(organizationId, input.product_id, `${prefix}-%`) as { n: number }
        ).n
      ) + 1;
    code = `${prefix}-${n}`;
  }

  try {
    return Number(
      (await db
        .prepare(
          `INSERT INTO batches
             (organization_id, product_id, batch_code, supplier_batch_ref, purchase_line_id,
              produced_at, expiry_date, qty_received_base, unit_cost_toman, status, notes,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
        )
        .run(
          organizationId,
          input.product_id,
          code,
          input.supplier_batch_ref ?? null,
          input.purchase_line_id ?? null,
          producedAt,
          expiry,
          input.qty_received_base,
          input.unit_cost_toman ?? 0,
          input.notes ?? null,
          now,
          now
        )).lastInsertRowid
    );
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      throw new BatchError(`سری ساخت «${code}» برای این کالا قبلاً ثبت شده است`);
    }
    throw e;
  }
}

export async function createBatch(organizationId: number, input: CreateBatchInput): Promise<number> {
  const db = batchesRepo.db();
  await db.exec("BEGIN IMMEDIATE");
  try {
    const id = await createBatchTxn(db, organizationId, input);
    await db.exec("COMMIT");
    return id;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

/** Move a batch's status, enforcing lib/batchStates. `expired` / `depleted` are computed
 *  by the sweep, never set here. A recall raises a reminder for every customer that
 *  received the lot. One transaction. */
export async function advanceBatchStatus(organizationId: number, id: number, to: BatchStatus): Promise<void> {
  const db = batchesRepo.db();
  await db.exec("BEGIN IMMEDIATE");
  try {
    const batch = await batchesRepo.get(organizationId, id);
    if (!batch) throw new BatchError("سری ساخت پیدا نشد");
    if (to === "expired" || to === "depleted") {
      throw new BatchError("این وضعیت خودکار محاسبه می‌شود");
    }
    if (!canTransitionBatch(batch.status, to)) {
      throw new BatchError(
        `گذار از «${batch.status}» به «${to}» مجاز نیست` +
          (BATCH_TRANSITIONS[batch.status].length === 0 ? " (وضعیت نهایی)" : "")
      );
    }

    const now = new Date().toISOString();
    await db.prepare("UPDATE batches SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?").run(
      to,
      now,
      id,
      organizationId
    );

    if (to === "recalled") {
      const customers = await db
        .prepare(
          `SELECT DISTINCT o.customer_id AS id
             FROM delivery_line_batches dlb
             JOIN delivery_stops s ON s.id = dlb.delivery_stop_id
             JOIN orders o ON o.id = s.order_id
            WHERE dlb.batch_id = ? AND dlb.organization_id = ?`
        )
        .all(id, organizationId) as unknown as { id: number }[];
      const ins = db.prepare(
        `INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at)
         VALUES ('customer', ?, ?, ?, 0, ?)`
      );
      const msg = `سری ساخت ${batch.batch_code} فراخوان شد — پیگیری کنید`;
      for (const c of customers) await ins.run(c.id, now.slice(0, 10), msg, now);
    }

    await db.exec("COMMIT");
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {
      // already committed / no open transaction
    }
    throw e;
  }
}

/** Set `expired` on batches past their date and `depleted` on batches with no stock
 *  left. Idempotent; safe every boot. Returns the counts changed. */
export async function sweepBatchStatuses(organizationId?: number): Promise<{ expired: number; depleted: number }> {
  const db = batchesRepo.db();
  const now = new Date().toISOString();
  const orgClause = organizationId !== undefined ? "AND organization_id = ?" : "";
  const orgArg = organizationId !== undefined ? [organizationId] : [];

  const expired = Number(
    (await db
      .prepare(
        `UPDATE batches SET status = 'expired', updated_at = ?
          WHERE status IN ('active', 'quarantined')
            AND expiry_date IS NOT NULL AND expiry_date < date('now') ${orgClause}`
      )
      .run(now, ...(orgArg as never[]))).changes
  );

  const depleted = Number(
    (await db
      .prepare(
        `UPDATE batches SET status = 'depleted', updated_at = ?
          WHERE status IN ('active', 'quarantined', 'expired')
            AND COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.batch_id = batches.id), 0) <= 0
            ${orgClause}`
      )
      .run(now, ...(orgArg as never[]))).changes
  );

  return { expired, depleted };
}

export async function listBatches(
  organizationId: number,
  filter?: { product_id?: number; status?: BatchStatus }
): Promise<Array<BatchRow & { on_hand: number }>> {
  const clauses = ["b.organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter?.product_id !== undefined) {
    clauses.push("b.product_id = ?");
    params.push(filter.product_id);
  }
  if (filter?.status !== undefined) {
    clauses.push("b.status = ?");
    params.push(filter.status);
  }
  return await batchesRepo
    .db()
    .prepare(
      `SELECT b.*,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.batch_id = b.id), 0) AS on_hand
         FROM batches b
        WHERE ${clauses.join(" AND ")}
        ORDER BY (b.expiry_date IS NULL), b.expiry_date, b.id`
    )
    .all(...(params as never[])) as unknown as Array<BatchRow & { on_hand: number }>;
}

export interface ExpiringBatch extends BatchRow {
  on_hand: number;
  days_to_expiry: number | null;
}

/** Batches still holding stock that are past expiry or inside their alert window. The
 *  per-batch window is `max(7, floor(shelf_life_days * 0.25))`, or a flat 14 days when
 *  the product has no shelf life set. */
export async function expiringBatches(
  organizationId: number,
  opts?: { withinDays?: number; asOf?: string }
): Promise<ExpiringBatch[]> {
  const asOf = (opts?.asOf ?? new Date().toISOString()).slice(0, 10);
  const rows = await batchesRepo
    .db()
    .prepare(
      `SELECT b.*, p.shelf_life_days AS _shelf,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.batch_id = b.id), 0) AS on_hand
         FROM batches b
         JOIN products p ON p.id = b.product_id
        WHERE b.organization_id = ? AND b.status IN ('active', 'quarantined')
          AND b.expiry_date IS NOT NULL`
    )
    .all(organizationId) as unknown as (BatchRow & { _shelf: number | null; on_hand: number })[];

  const out: ExpiringBatch[] = [];
  for (const r of rows) {
    if (r.on_hand <= 0) continue;
    const window =
      opts?.withinDays ??
      (r._shelf && r._shelf > 0 ? Math.max(7, Math.floor(r._shelf * 0.25)) : 14);
    const days = Math.floor(
      (Date.parse(r.expiry_date as string) - Date.parse(asOf)) / 86_400_000
    );
    if (days <= window) {
      const { _shelf, ...batch } = r;
      void _shelf;
      out.push({ ...batch, days_to_expiry: days });
    }
  }
  return out.sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0));
}

export interface BatchTrace {
  batch: BatchRow;
  purchase: {
    purchase_id: number;
    supplier: string | null;
    purchase_date: string;
    unit_cost_toman: number;
  } | null;
  deliveries: Array<{
    delivery_stop_id: number;
    order_id: number;
    order_no: string;
    customer_id: number;
    customer_name: string;
    base_qty: number;
    delivered_at: string | null;
  }>;
  complaints: number;
}

/** Forward trace: this batch → the purchase line it came in on, and every delivery that
 *  carried it out to a customer. */
export async function batchTrace(organizationId: number, batchId: number): Promise<BatchTrace | null> {
  const batch = await batchesRepo.get(organizationId, batchId);
  if (!batch) return null;
  const db = batchesRepo.db();

  let purchase: BatchTrace["purchase"] = null;
  if (batch.purchase_line_id) {
    purchase =
      (await db
        .prepare(
          `SELECT pu.id AS purchase_id, pu.supplier, pu.purchase_date, pl.unit_cost_toman
             FROM purchase_lines pl JOIN purchases pu ON pu.id = pl.purchase_id
            WHERE pl.id = ?`
        )
        .get(batch.purchase_line_id) as BatchTrace["purchase"]) ?? null;
  }

  const deliveries = await db
    .prepare(
      `SELECT dlb.delivery_stop_id, o.id AS order_id, o.order_no,
              o.customer_id, c.business_name AS customer_name,
              dlb.base_qty, o.delivered_at
         FROM delivery_line_batches dlb
         JOIN delivery_stops s ON s.id = dlb.delivery_stop_id
         JOIN orders o ON o.id = s.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE dlb.batch_id = ? AND dlb.organization_id = ?
        ORDER BY o.delivered_at, o.id`
    )
    .all(batchId, organizationId) as unknown as BatchTrace["deliveries"];

  const complaints = Number(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM quality_complaints WHERE batch_id = ? AND organization_id = ?"
        )
        .get(batchId, organizationId) as { n: number }
    ).n
  );

  return { batch, purchase, deliveries, complaints };
}

/** Every batch with its product's name, soonest expiry first, for the batch list on
 *  /sales/stock (item 18). One query; the name join is why this is not listBatches. */
export async function listBatchesWithProduct(organizationId: number): Promise<Array<BatchRow & { on_hand: number; product_name: string }>> {
  return await batchesRepo
    .db()
    .prepare(
      `SELECT b.*, p.name AS product_name,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.batch_id = b.id), 0) AS on_hand
         FROM batches b
         JOIN products p ON p.id = b.product_id
        WHERE b.organization_id = ?
        ORDER BY (b.expiry_date IS NULL), b.expiry_date, b.id`,
    )
    .all(organizationId) as unknown as Array<BatchRow & { on_hand: number; product_name: string }>;
}
