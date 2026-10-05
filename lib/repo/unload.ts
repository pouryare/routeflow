// The end of the day: what came back, and where each part of it went.
//
// This is a RECONCILIATION, not a number. The ledger already knows what went out and what got
// delivered, so every line is PRE-FILLED and the driver confirms or corrects. That is why
// `shouldReturn` asks the ledger rather than recomputing anything:
//
//   should come back = vanOnHand(van, product)
//
// Asked, not derived, so it cannot drift from the movements, and the same answer at noon and
// at six. The first draft of spec 3 said `loaded - delivered`, which over-counted by exactly
// the refused quantity -- a refused stop writes no deliveries row, its goods never left, and
// the formula counted them as gone. Asking removes the whole class of error.
//
// Two rules this module does not soften:
//   1. Declaring LESS than the balance refuses and names the gap. A half-truth is worse than
//      none: the van's balance would then be quietly wrong forever, and nobody would know.
//   2. One transaction or none. Every line is validated BEFORE any is written.

import { getDb } from "@/lib/db";
import { recordMovementsTxn, StockError, type MovementInput } from "@/lib/repo/stock";
import { vanOnHand } from "@/lib/repo/vanStock";

export type Disposition =
  | "returned"
  | "damaged"
  | "expired"
  | "discarded"
  | "lost"
  | "sample";

export const DISPOSITIONS: Disposition[] = [
  "returned",
  "damaged",
  "expired",
  "discarded",
  "lost",
  "sample",
];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  returned: "برگشت به انبار",
  damaged: "خراب",
  expired: "تاریخ مصرف گذشته",
  discarded: "دور ریخته شد",
  lost: "گم شده",
  sample: "نمونه",
};

export interface UnloadLine {
  productId: number;
  disposition: Disposition;
  qty: number;
  note?: string | null;
}

export interface UnloadInput {
  runId: number;
  organizationId: number;
  vanFacilityId: number;
  /** Where the extras go. NOT always a warehouse -- the owner receives returns at his house. */
  facilityId: number;
  lines: UnloadLine[];
  actorId: number | null;
  note?: string | null;
}

/** The one definition of "how much should come back". Asks the ledger.
 *
 *  Deliberately has no time argument, which is what makes the same number true at noon and at
 *  six: there is nothing to vary. */
export function shouldReturn(
  organizationId: number,
  vanFacilityId: number,
  productId: number
): number {
  return vanOnHand(organizationId, vanFacilityId, productId);
}

/** What the ledger says should come back, per product, for the sheet to pre-fill. */
export function shouldReturnByProduct(
  organizationId: number,
  vanFacilityId: number,
  productIds: readonly number[]
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const id of productIds) out[id] = shouldReturn(organizationId, vanFacilityId, id);
  return out;
}

/** The samples facility for this tenant, created on first use.
 *
 *  Every movement needs a destination or the books do not balance: a sample that went nowhere
 *  would leave the warehouse's on-hand permanently wrong by the sampled amount, with nothing
 *  recording that it went wrong. A named, permanent place means on-hand correctly EXCLUDES
 *  them, "how many samples did we give away this month?" is one query, and the audit trail
 *  survives.
 *
 *  Idempotent per tenant via `INSERT OR IGNORE` on UNIQUE (organization_id, slug). */
export function samplesFacility(organizationId: number): number {
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT id FROM facilities WHERE organization_id = ? AND slug = 'samples-given'"
    )
    .get(organizationId) as { id: number } | undefined;
  if (existing) return existing.id;

  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO facilities (slug, kind, name, lat, lng, organization_id, created_at, updated_at)
     VALUES ('samples-given', 'other', 'نمونه‌های داده‌شده', NULL, NULL, ?, ?, ?)`
  ).run(organizationId, now, now);
  const row = db
    .prepare("SELECT id FROM facilities WHERE organization_id = ? AND slug = 'samples-given'")
    .get(organizationId) as { id: number };
  return row.id;
}

/** What ledger movement each disposition writes.
 *
 *  `damaged`, `expired`, `discarded` and `lost` all become WRITE_OFF -- the goods are gone
 *  from the books either way -- but they are kept as FOUR separate dispositions upstream so a
 *  manager can see which problem is actually happening. "We break a lot of stock" and "our
 *  supplier keeps sending expired goods" are different conversations. */
function movementsFor(
  line: UnloadLine,
  vanFacilityId: number,
  destinationId: number
): MovementInput[] {
  const base = {
    product_id: line.productId,
    batch_id: null,
    ref_type: "run_unload",
    occurred_at: new Date().toISOString(),
  };
  switch (line.disposition) {
    case "returned":
      return [
        { ...base, facility_id: vanFacilityId, base_qty: -line.qty, kind: "TRANSFER_OUT" },
        { ...base, facility_id: destinationId, base_qty: line.qty, kind: "TRANSFER_IN" },
      ];
    case "sample":
      // ONE leg, and it is a movement OUT of the van tagged SAMPLE_OUT. There is deliberately
      // no inbound leg and no second facility: the samples place is where the goods ended up,
      // not a shelf they are sitting on, so counting them into its on-hand would put free
      // goods back into stock. The run_unload_lines row is the record of the destination.
      return [
        {
          ...base,
          facility_id: vanFacilityId,
          base_qty: -line.qty,
          kind: "SAMPLE_OUT",
        },
      ];
    default:
      // damaged | expired | discarded | lost -- gone from the books either way.
      return [{ ...base, facility_id: vanFacilityId, base_qty: -line.qty, kind: "WRITE_OFF" }];
  }
}

/** Record what came back. All of it, or none of it.
 *
 *  The sheet pre-fills every line from `shouldReturn`, so confirming is one tap. The driver
 *  corrects when reality disagrees -- and because declaring LESS than the balance is refused,
 *  the only way to record a shortfall is to say which disposition it went under.
 *
 *  Refusing the shortfall is the whole design. A partial write would leave the van's balance
 *  wrong with no record that it was ever reconciled, which is the failure `vanStock.ts` exists
 *  to prevent. */
export function reconcileUnload(input: UnloadInput): void {
  if (input.lines.length === 0) {
    throw new StockError("حداقل یک قلم برای تخلیه لازم است");
  }
  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new StockError("مقدار هر قلم باید عدد صحیح بزرگ‌تر از صفر باشد");
    }
    if (!DISPOSITIONS.includes(line.disposition)) {
      throw new StockError(`نوع تخلیه نامعتبر است: ${line.disposition}`);
    }
  }

  const db = getDb();

  // Validate EVERY line against the ledger before writing ANY of them.
  const declared = new Map<number, number>();
  for (const line of input.lines) {
    declared.set(line.productId, (declared.get(line.productId) ?? 0) + line.qty);
  }
  for (const [productId, qty] of declared) {
    const expected = shouldReturn(input.organizationId, input.vanFacilityId, productId);
    if (qty > expected) {
      throw new StockError(
        `بیش از موجودی وانت اعلام شده است (کالای ${productId}: ${expected} موجود، ${qty} اعلام شد)`
      );
    }
    if (qty < expected) {
      // The gap is named, not swallowed. A driver is told exactly how much is unaccounted for
      // and must declare where it went rather than closing the day with a silent difference.
      throw new StockError(
        `${expected - qty} از کالای ${productId} تعیین تکلیف نشده است (${expected} باید برگردد، ${qty} اعلام شد)`
      );
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const movements: MovementInput[] = [];
    for (const line of input.lines) {
      movements.push(
        ...movementsFor(
          { ...line, note: line.note ?? null },
          input.vanFacilityId,
          input.facilityId
        )
      );
      db.prepare(
        `INSERT INTO run_unload_lines (run_id, product_id, disposition, qty_base, note, occurred_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.runId,
        line.productId,
        line.disposition,
        line.qty,
        line.note ?? null,
        new Date().toISOString(),
        input.actorId,
        new Date().toISOString()
      );
    }
    recordMovementsTxn(db, input.organizationId, movements);
    db.prepare(
      `UPDATE run_facility_stops
          SET status = 'done', done_at = ?, done_by = ?, notes = COALESCE(?, notes), updated_at = ?
        WHERE run_id = ? AND role = 'unload'`
    ).run(new Date().toISOString(), input.actorId, input.note ?? null, new Date().toISOString(), input.runId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** What is on the van right now, per product -- the sheet's starting point. */
export function vanBalance(
  organizationId: number,
  vanFacilityId: number
): { productId: number; qty: number }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT product_id, SUM(base_qty) AS qty
         FROM stock_movements
        WHERE organization_id = ? AND facility_id = ?
        GROUP BY product_id
       HAVING SUM(base_qty) <> 0`
    )
    .all(organizationId, vanFacilityId) as unknown as { product_id: number; qty: number }[];
  return rows.map((r) => ({ productId: r.product_id, qty: r.qty }));
}