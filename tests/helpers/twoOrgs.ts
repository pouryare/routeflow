import type { DatabaseSync } from "node:sqlite";

export interface OrgFixture {
  orgId: number;
  groupId: number;
  ownerId: number;
  managerId: number;
  customerId: number;
  productId: number;
  orderId: number;
  repId: number;
  creditApprovalId: number;
}

const NOW = "2026-01-01T00:00:00.000Z";

/** Two complete, independent companies in one database.
 *
 *  Every row a tenant can own is created for both, with values chosen to *collide* --
 *  the same customer code, the same SKU, the same order number. A test that passes
 *  against this fixture has proved isolation, rather than proved that the ids happened
 *  to differ. */
export function seedTwoOrgs(db: DatabaseSync): { a: OrgFixture; b: OrgFixture } {
  const insert = (sql: string, ...params: unknown[]): number =>
    Number(db.prepare(sql).run(...(params as never[])).lastInsertRowid);

  const build = (orgId: number, tag: string): OrgFixture => {
    if (orgId !== 1) {
      db.prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
      ).run(orgId, `Org ${tag.toUpperCase()}`, `org-${tag}`, NOW);
    }

    const groupId = insert(
      "INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, ?, ?, ?)",
      `گروه ${tag}`,
      `g-${tag}`,
      NOW,
      orgId
    );

    const ownerId = insert(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, created_at)
       VALUES (?, 'x:y', ?, 'owner', NULL, ?, ?)`,
      `owner-${tag}`,
      `مالک ${tag}`,
      orgId,
      NOW
    );

    const managerId = insert(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, created_at)
       VALUES (?, 'x:y', ?, 'group_manager', ?, ?, ?)`,
      `manager-${tag}`,
      `مدیر ${tag}`,
      groupId,
      orgId,
      NOW
    );

    // Colliding natural keys on purpose -- these are identical in both organisations.
    const customerId = insert(
      `INSERT INTO customers (customer_code, business_name, synced_at, group_id, organization_id)
       VALUES ('SHARED-001', ?, ?, ?, ?)`,
      `مشتری ${tag}`,
      NOW,
      groupId,
      orgId
    );

    const productId = insert(
      `INSERT INTO products (name, sku, created_at, updated_at, organization_id)
       VALUES (?, 'SHARED-SKU', ?, ?, ?)`,
      `کره ${tag}`,
      NOW,
      NOW,
      orgId
    );

    const orderId = insert(
      `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, order_date,
                           created_by, created_at, updated_at, organization_id)
       VALUES ('1001', ?, ?, ?, '2026-01-01', ?, ?, ?, ?)`,
      customerId,
      groupId,
      managerId,
      managerId,
      NOW,
      NOW,
      orgId
    );

    // A representative sharing a rep_code with the other org, to prove per-tenant
    // uniqueness on representative_profiles.
    const repCustomerId = insert(
      `INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, group_id, organization_id)
       VALUES ('SHARED-REP-CUST', ?, 'WHOLESALE', 'active', ?, ?, ?)`,
      `نماینده ${tag}`,
      NOW,
      groupId,
      orgId
    );
    const repId = insert(
      `INSERT INTO representative_profiles (organization_id, customer_id, rep_code, stage, credit_terms_days, created_at, updated_at)
       VALUES (?, ?, 'SHARED-REP', 'active', 0, ?, ?)`,
      orgId,
      repCustomerId,
      NOW,
      NOW
    );

    const creditApprovalId = insert(
      `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at,
                                     customer_balance_toman, credit_limit_toman, overage_toman, status)
       VALUES (?, ?, ?, ?, 1000, 0, 1000, 'pending')`,
      orgId,
      orderId,
      managerId,
      NOW
    );

    return {
      orgId,
      groupId,
      ownerId,
      managerId,
      customerId,
      productId,
      orderId,
      repId,
      creditApprovalId,
    };
  };

  return { a: build(1, "a"), b: build(2, "b") };
}
