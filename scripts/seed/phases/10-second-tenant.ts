/** A second tenant, so the org switcher has something to switch TO.
 *
 *  Deliberately SMALL. Its job is to prove isolation — the auth filter and every
 *  `makeRepo({tenant:true})` read — not to be a second full demo. A big one would only slow
 *  the build down and prove the same thing.
 *
 *  LAST in the order, so the refresh sweeps in phase 09 can cover both organisations.
 *
 *  `createRun` checks `user_roles`, not `users.role` — a role written only to `users` is
 *  invisible to it and the account silently has no permissions.
 */

import type { SeedContext } from "../context";

const TENANTS = [
  { slug: "pishro", name: "پیشرو پخش", phone: "02111110000" },
  { slug: "sepehr", name: "سپهر تجارت", phone: "02122220000" },
];

export async function run(ctx: SeedContext): Promise<void> {
  const { db, rng } = ctx;
  const now = ctx.stamp(0);

  /* `organizations` has NO `phone` column — it is `contact_name` / `contact_phone`
     (verified by PRAGMA table_info, not assumed). */
  const insOrg = db.prepare(
    `INSERT INTO organizations (name, slug, contact_name, contact_phone, created_at, active, plan)
     VALUES (?, ?, ?, ?, ?, 1, 'standard')`,
  );
  const insUser = db.prepare(
    `INSERT INTO users (organization_id, username, display_name, password_hash, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
  );
  const insRole = db.prepare(
    `INSERT INTO user_roles (user_id, role) VALUES (?, ?)`,
  );
  /* `customers` has NO `created_at`/`created_by` — the timestamp column is `synced_at`, and
     `created_by` does not exist at all (phase 04's insert is the reference). */
  const insCustomer = db.prepare(
    `INSERT INTO customers (organization_id, customer_code, business_name, phone, lifecycle,
                           customer_type, synced_at, source_code, credit_limit_toman,
                           payment_terms_days, verification, contact_status, owner_user_id)
     VALUES (?, ?, ?, ?, 'active', 'WHOLESALE', ?, 'demo', 0, 30, 'unverified', 'new', ?)`,
  );

  const products = ctx.ids.productIds ?? [];
  const tenantOrgIds: Record<string, number> = {};
  ctx.ids.tenantOrgIds = tenantOrgIds;

  /* The owner row from phase 01 supplies the password hash — re-hashing would need bcrypt and
     a real cost, and the demo password is identical across tenants by design. */
  const hash = (
    await db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(ctx.staff.owner) as
      | { password_hash: string }
      | undefined
  )?.password_hash;
  if (!hash) throw new Error("phase 10: no owner password hash to reuse");

  /* COPY the catalogue, do not MOVE it.
   *
   * An earlier draft did `UPDATE products SET organization_id = <tenant>` on the primary
   * tenant's rows. That is a real defect and not a subtle one: it hands the primary tenant's
   * catalogue to somebody else, so every tenant-scoped read on the main demo loses rows and
   * the isolation this phase exists to demonstrate is destroyed by the phase itself. Each
   * tenant gets its OWN product rows instead. */
  interface ProductTemplate {
    name: string;
    base_unit: string;
    kg_per_base_unit: number;
    avg_cost_toman: number;
    reorder_point: number | null;
    target_stock: number | null;
    shelf_life_days: number | null;
    volume_m3_per_base_unit: number | null;
  }
  /* Typed as an interface, not `Record<string, unknown>` — node:sqlite's parameter type is
     `SQLInputValue`, so `unknown` is not assignable and every bind is a TS error. */
  const productTemplate: ProductTemplate | null = products.length
    ? ((await db
        .prepare(`SELECT name, base_unit, kg_per_base_unit, avg_cost_toman, reorder_point,
                         target_stock, shelf_life_days, volume_m3_per_base_unit
                    FROM products WHERE id = ?`)
        .get(products[0]) as ProductTemplate | undefined) ?? null)
    : null;
  const insProduct = db.prepare(
    `INSERT INTO products (organization_id, name, sku, base_unit, kg_per_base_unit,
                           avg_cost_toman, active, created_at, updated_at, reorder_point,
                           target_stock, shelf_life_days, volume_m3_per_base_unit)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  );

  let customers = 0;

  for (const [i, t] of TENANTS.entries()) {
    const orgId = Number(
      (await insOrg.run(t.name, `${t.slug}-demo`, `مدیر ${t.name}`, t.phone, now)).lastInsertRowid,
    );
    tenantOrgIds[t.slug] = orgId;

    const username = `${t.slug}.owner`;
    const userId = Number(
      (await insUser.run(orgId, username, `مالک ${t.name}`, hash, now)).lastInsertRowid,
    );
    /* BOTH rows. `createRun` reads user_roles, and the role-gate reads it too — writing only
       `users.role` is the trap the plan flagged. */
    await insRole.run(userId, "owner");
    await insRole.run(userId, "sales_manager");

    /* Printed in the summary. Without this the tenant switcher offers an org nobody can log
       into, which looks like a broken build rather than an unreported one. */
    ctx.logins.push({ username, role: "owner (tenant 2)", password: "demo1234" });

    for (let c = 0; c < 6; c++) {
      await insCustomer.run(
        orgId, `${t.slug.toUpperCase()}-C${c + 1}`, `مشتری ${t.name} ${c + 1}`,
        `021${rng.int(1000000, 9999999)}`, now, userId,
      );
      customers++;
    }

    /* A handful of tenant-owned products, so the tenant's screens are not blank shells. */
    if (productTemplate) {
      for (let k = 0; k < 4; k++) {
        await insProduct.run(
          orgId,
          `${productTemplate.name} ${t.name}`,
          `${t.slug.toUpperCase()}-SKU-${k + 1}`,
          productTemplate.base_unit, productTemplate.kg_per_base_unit,
          productTemplate.avg_cost_toman, now, now, productTemplate.reorder_point,
          productTemplate.target_stock, productTemplate.shelf_life_days,
          productTemplate.volume_m3_per_base_unit,
        );
      }
    }
    void i;
  }

  ctx.progress(
    `${TENANTS.length} tenants (${TENANTS.map((t) => t.slug).join(", ")}), ${customers} customers`,
  );
}
