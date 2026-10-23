/** Purchases from suppliers, with batches, so stock is real.
 *
 *  `stock_movements.facility_id` is NOT NULL and `getDb()` creates no facility — phase 01's
 *  `demo-depot` is the reason that phase exists.
 *
 *  `postPurchase` is the REAL ledger writer and takes a `db` as its first argument, opening
 *  NO transaction. Do not use a `record*`-style wrapper here: SQLite refuses to nest.
 */

import { postPurchase } from "@/lib/repo/ledgerPostings";
import type { SeedContext } from "../context";
import { mapSeq } from "@/lib/seq";

const SUPPLIERS = [
  { name: "شرکت پخش لبنیات پارس", phone: "02188776655" },
  { name: "تعاونیه تولیدکنندگان شیر", phone: "02133445566" },
  { name: "بازرگانی آریا واردات", phone: "02155667788" },
  { name: "صنایع غذایی کویر", phone: "02177889900" },
];

export async function run(ctx: SeedContext): Promise<void> {
  const { db, rng, scale } = ctx;
  const owner = ctx.staff.owner;
  const facilityId = ctx.ids.facility!;
  const products = ctx.ids.productIds!;
  const now = ctx.stamp(0);

  /* `suppliers` has NO updated_at — (organization_id, name, phone, notes, active,
     created_by, created_at). Adding one throws "no such column". */
  const insSupplier = db.prepare(
    `INSERT INTO suppliers (name, phone, organization_id, created_by, created_at, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const supplierIds = await mapSeq(SUPPLIERS, async (s) => Number((await insSupplier.run(s.name, s.phone, ctx.orgId, owner, now)).lastInsertRowid));

  const insPurchase = db.prepare(
    `INSERT INTO purchases (supplier_id, purchase_date, invoice_no, created_by, created_at,
                            organization_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insLine = db.prepare(
    `INSERT INTO purchase_lines (purchase_id, product_id, base_qty, unit_cost_toman, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insBatch = db.prepare(
    `INSERT INTO batches (organization_id, product_id, batch_code, purchase_line_id, produced_at,
                          expiry_date, qty_received_base, unit_cost_toman, status, created_at,
                          updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  );
  const insMove = db.prepare(
    `INSERT INTO stock_movements (organization_id, facility_id, product_id, batch_id, base_qty,
                                  kind, ref_type, ref_id, occurred_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'PURCHASE_IN', 'PURCHASE', ?, ?, ?, ?)`,
  );

  const purchases = Math.max(4, Math.round((scale.months * 30) / 14));
  let batchSeq = 0;
  let moved = 0;

  for (let p = 0; p < purchases; p++) {
    const daysAgo = Math.round((p / purchases) * (scale.months * 30));
    const when = ctx.stamp(daysAgo);
    const supplierId = await rng.pick(supplierIds);
    const purchaseId = Number(
      (await insPurchase.run(
        supplierId, ctx.iso(daysAgo), `DEMO-INV-${String(p + 1).padStart(4, "0")}`,
        owner, now, ctx.orgId,
      )).lastInsertRowid,
    );

    let totalToman = 0;
    for (const productId of products) {
      if (rng.chance(0.35)) continue;
      const product = await db
        .prepare(`SELECT avg_cost_toman FROM products WHERE id = ?`)
        .get(productId) as { avg_cost_toman: number };
      const qty = rng.int(60, 400);
      /* Cost drifts +/-12% off catalogue, so margin varies by product the way a real book
         does rather than every line landing on the same percentage. */
      const unitCost = Math.round((product.avg_cost_toman * (0.88 + rng.next() * 0.24)) / 100) * 100;
      totalToman += qty * unitCost;

      const lineId = Number(
        (await insLine.run(purchaseId, productId, qty, unitCost, when)).lastInsertRowid,
      );
      batchSeq++;
      const batchId = Number(
        (await insBatch.run(
          ctx.orgId, productId, `DEMO-B${String(batchSeq).padStart(5, "0")}`, lineId,
          when, ctx.iso(daysAgo - 21), qty, unitCost, when, when,
        )).lastInsertRowid,
      );
      await insMove.run(
        ctx.orgId, facilityId, productId, batchId, qty, purchaseId, when, owner, when,
      );
      moved++;
    }

    /* The REAL purchase posting, so the supplier payable ledger exists before phase 07 pays
       any of it. Dr 1203 / Cr 2101. */
    if (totalToman > 0) {
      await postPurchase(db, {
        organizationId: ctx.orgId,
        purchaseId,
        supplierId,
        totalToman,
        purchasedAt: when,
        purchasedBy: owner,
      });
    }
  }

  ctx.progress(
    `${supplierIds.length} suppliers, ${purchases} purchases, ${batchSeq} batches, ` +
      `${moved} stock movements`,
  );
}
