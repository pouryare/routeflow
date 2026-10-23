import type { Db } from "@/lib/database/client";

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
  paymentId: number;
  chequeId: number;
  batchId: number;
  stockMovementId: number;
  complaintId: number;
  reasonCodeId: number;
  deliveryId: number;
  syncMutationId: number;
  vehicleId: number;
  routeTemplateId: number;
  capacityFactorId: number;
  taskId: number;
  alertId: number;
  objectionCardId: number;
  kpiSnapshotId: number;
  forecastModelId: number;
  churnScoreId: number;
}

const NOW = "2026-01-01T00:00:00.000Z";

/** Two complete, independent companies in one database.
 *
 *  Every row a tenant can own is created for both, with values chosen to *collide* --
 *  the same customer code, the same SKU, the same order number. A test that passes
 *  against this fixture has proved isolation, rather than proved that the ids happened
 *  to differ. */
export async function seedTwoOrgs(db: Db): Promise<{ a: OrgFixture; b: OrgFixture }> {
  const insert = async (sql: string, ...params: unknown[]): Promise<number> =>
    Number((await db.prepare(sql).run(...(params as never[]))).lastInsertRowid);

  const build = async (orgId: number, tag: string): Promise<OrgFixture> => {
    if (orgId !== 1) {
      await db.prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
      ).run(orgId, `Org ${tag.toUpperCase()}`, `org-${tag}`, NOW);
    }

    const groupId = await insert(
      "INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, ?, ?, ?)",
      `گروه ${tag}`,
      `g-${tag}`,
      NOW,
      orgId
    );

    const ownerId = await insert(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, created_at)
       VALUES (?, 'x:y', ?, 'owner', NULL, ?, ?)`,
      `owner-${tag}`,
      `مالک ${tag}`,
      orgId,
      NOW
    );

    const managerId = await insert(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, created_at)
       VALUES (?, 'x:y', ?, 'group_manager', ?, ?, ?)`,
      `manager-${tag}`,
      `مدیر ${tag}`,
      groupId,
      orgId,
      NOW
    );

    // Colliding natural keys on purpose -- these are identical in both organisations.
    const customerId = await insert(
      `INSERT INTO customers (customer_code, business_name, synced_at, group_id, organization_id)
       VALUES ('SHARED-001', ?, ?, ?, ?)`,
      `مشتری ${tag}`,
      NOW,
      groupId,
      orgId
    );

    const productId = await insert(
      `INSERT INTO products (name, sku, created_at, updated_at, organization_id)
       VALUES (?, 'SHARED-SKU', ?, ?, ?)`,
      `کره ${tag}`,
      NOW,
      NOW,
      orgId
    );

    const orderId = await insert(
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
    const repCustomerId = await insert(
      `INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, group_id, organization_id)
       VALUES ('SHARED-REP-CUST', ?, 'WHOLESALE', 'active', ?, ?, ?)`,
      `نماینده ${tag}`,
      NOW,
      groupId,
      orgId
    );
    const repId = await insert(
      `INSERT INTO representative_profiles (organization_id, customer_id, rep_code, stage, credit_terms_days, created_at, updated_at)
       VALUES (?, ?, 'SHARED-REP', 'active', 0, ?, ?)`,
      orgId,
      repCustomerId,
      NOW,
      NOW
    );

    const creditApprovalId = await insert(
      `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at,
                                     customer_balance_toman, credit_limit_toman, overage_toman, status)
       VALUES (?, ?, ?, ?, 1000, 0, 1000, 'pending')`,
      orgId,
      orderId,
      managerId,
      NOW
    );

    // A payment and a cheque per org, the cheque_no colliding across tenants to prove
    // the per-tenant UNIQUE holds.
    const paymentId = await insert(
      `INSERT INTO payments (organization_id, customer_id, amount_toman, method, received_at, received_by, created_at)
       VALUES (?, ?, 10000, 'CASH', ?, ?, ?)`,
      orgId,
      customerId,
      NOW,
      ownerId,
      NOW
    );
    const chequeId = await insert(
      `INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, due_date, status,
                            received_at, received_by, created_at, updated_at)
       VALUES (?, ?, 20000, 'SHARED-CHQ', ?, 'in_hand', ?, ?, ?, ?)`,
      orgId,
      customerId,
      NOW,
      NOW,
      ownerId,
      NOW,
      NOW
    );

    // Phase 2: a facility, a batch (colliding batch_code), a PURCHASE_IN movement and a
    // complaint per org.
    const facilityId = await insert(
      `INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at)
       VALUES (?, 'warehouse', ?, 35, 51, ?, ?, ?)`,
      `wh-${tag}`,
      `انبار ${tag}`,
      NOW,
      orgId,
      NOW
    );
    const batchId = await insert(
      `INSERT INTO batches (organization_id, product_id, batch_code, qty_received_base, unit_cost_toman,
                            status, created_at, updated_at)
       VALUES (?, ?, 'SHARED-BATCH', 50, 1000, 'active', ?, ?)`,
      orgId,
      productId,
      NOW,
      NOW
    );
    const stockMovementId = await insert(
      `INSERT INTO stock_movements (organization_id, facility_id, product_id, batch_id, base_qty, kind,
                                    occurred_at, created_at)
       VALUES (?, ?, ?, ?, 50, 'PURCHASE_IN', ?, ?)`,
      orgId,
      facilityId,
      productId,
      batchId,
      NOW,
      NOW
    );
    const complaintId = await insert(
      `INSERT INTO quality_complaints (organization_id, customer_id, product_id, batch_id, reported_at,
                                       reported_by, category, severity, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'spoilage', 'medium', 'open', ?)`,
      orgId,
      customerId,
      productId,
      batchId,
      NOW,
      ownerId,
      NOW
    );

    // Phase 3: a reason code (colliding code, per-tenant), a delivery row and the
    // order's 'create' event.
    const reasonCodeId = await insert(
      `INSERT INTO reason_codes (organization_id, domain, code, label_fa, active, created_at)
       VALUES (?, 'delivery_fail', 'SHARED-RC', ?, 1, ?)`,
      orgId,
      `دلیل ${tag}`,
      NOW
    );
    const deliveryId = await insert(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, created_at)
       VALUES (?, ?, 1, 'PLANNED', ?)`,
      orgId,
      orderId,
      NOW
    );
    await insert(
      `INSERT INTO order_events (organization_id, order_id, from_status, to_status, action, actor_user_id, created_at)
       VALUES (?, ?, NULL, 'DRAFT', 'create', ?, ?)`,
      orgId,
      orderId,
      ownerId,
      NOW
    );

    // Phase 4: a sync_mutations row (client_uuid colliding across orgs to prove the
    // UNIQUE is per-tenant) and a tombstone.
    const syncMutationId = await insert(
      `INSERT INTO sync_mutations (organization_id, client_uuid, user_id, op, payload_json,
                                   occurred_at, clock_skew_ms, received_at, status)
       VALUES (?, 'SHARED-MUT', ?, 'payment.record', '{}', ?, 0, ?, 'applied')`,
      orgId,
      ownerId,
      NOW,
      NOW
    );
    await insert(
      `INSERT INTO deleted_rows (organization_id, entity_type, entity_id, deleted_at)
       VALUES (?, 'order_line', 999, ?)`,
      orgId,
      NOW
    );

    // Phase 5: a vehicle (colliding plate to prove the per-tenant UNIQUE) + a template.
    const vehicleId = await insert(
      `INSERT INTO vehicles (organization_id, name, plate, created_at, updated_at)
       VALUES (?, ?, 'SHARED-PLATE', ?, ?)`,
      orgId,
      `وانت ${tag}`,
      NOW,
      NOW
    );
    const routeTemplateId = await insert(
      `INSERT INTO route_templates (organization_id, code, name, created_at, updated_at)
       VALUES (?, 'SHARED-RT', ?, ?, ?)`,
      orgId,
      `شرق ${tag}`,
      NOW,
      NOW
    );

    // Phase 6: a tenant capacity_factors override (same condition_code both orgs).
    const capacityFactorId = await insert(
      `INSERT INTO capacity_factors (organization_id, condition_code, stop_factor, updated_at)
       VALUES (?, 'heavy_rain', 0.5, ?)`,
      orgId,
      NOW
    );

    // Phase 7: a task, an alert, a target and a tenant rule override per org.
    const taskId = await insert(
      `INSERT INTO tasks (organization_id, kind, title, priority, status, created_at)
       VALUES (?, 'call', ?, 'NORMAL', 'open', ?)`,
      orgId,
      `تماس ${tag}`,
      NOW
    );
    const alertId = await insert(
      `INSERT INTO alerts (organization_id, severity, category, title, created_at)
       VALUES (?, 'warning', 'stock', ?, ?)`,
      orgId,
      `هشدار ${tag}`,
      NOW
    );
    await insert(
      `INSERT INTO targets (organization_id, user_id, group_id, period, metric, target_value, created_at)
       VALUES (?, ?, NULL, '1405-01', 'orders', 20, ?)`,
      orgId,
      managerId,
      NOW
    );
    await insert(
      `INSERT INTO rules (organization_id, code, name, trigger_kind, action_kind, created_at, updated_at)
       VALUES (?, 'SHARED-RULE', ?, 'sweep', 'task', ?, ?)`,
      orgId,
      `قانون ${tag}`,
      NOW,
      NOW
    );

    // Phase 8: a tenant objection-card override + a lesson_progress row per org.
    const objectionCardId = await insert(
      `INSERT INTO objection_cards (organization_id, outcome_code, customer_type, title_fa, script_fa, updated_at)
       VALUES (?, 'PRICE_OBJECTION', NULL, ?, ?, ?)`,
      orgId,
      `کارت ${tag}`,
      `متن ${tag}`,
      NOW
    );
    await insert(
      `INSERT INTO lesson_progress (organization_id, user_id, lesson_slug, completed_at)
       VALUES (?, ?, '02-phone-sales', ?)`,
      orgId,
      ownerId,
      NOW
    );

    // Phase 9: a tenant kpi_definitions override (renamed metric) + a couple of
    // kpi_snapshots rows per org.
    await insert(
      `INSERT INTO kpi_definitions
         (organization_id, metric, title_fa, definition_fa, formula_fa, owner_role, frequency, action_fa, updated_at)
       VALUES (?, 'net_sales', ?, 'تعریف', 'فرمول', 'owner', 'daily', 'اقدام', ?)`,
      orgId,
      `فروش ${tag}`,
      NOW
    );
    const kpiSnapshotId = await insert(
      `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, scope_id, period, value, computed_at)
       VALUES (?, 'net_sales', 'org', 0, '1405-06', ?, ?)`,
      orgId,
      orgId === 1 ? 111_000 : 222_000,
      NOW
    );
    await insert(
      `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, scope_id, period, value, computed_at)
       VALUES (?, 'orders', 'group', ?, '1405-06', ?, ?)`,
      orgId,
      groupId,
      orgId === 1 ? 12 : 34,
      NOW
    );

    // Phase 10: a tenant seasonal_factors override + a forecast_models row + a
    // churn_scores row per org.
    await insert(
      `INSERT INTO seasonal_factors (organization_id, kind, idx, factor, updated_at)
       VALUES (?, 'month', 1, ?, ?)`,
      orgId,
      orgId === 1 ? 1.3 : 0.7,
      NOW
    );
    const forecastModelId = await insert(
      `INSERT INTO forecast_models
         (organization_id, entity_type, entity_id, metric, method, level, trend, n_obs, updated_at)
       VALUES (?, 'org', 0, 'demand_toman', 'holt', ?, 10, 9, ?)`,
      orgId,
      orgId === 1 ? 100_000 : 200_000,
      NOW
    );
    const churnScoreId = await insert(
      `INSERT INTO churn_scores (organization_id, customer_id, probability, band, reason_fa, computed_at)
       VALUES (?, ?, ?, 'high', ?, ?)`,
      orgId,
      customerId,
      orgId === 1 ? 0.71 : 0.83,
      `دلیل ${tag}`,
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
      paymentId,
      chequeId,
      batchId,
      stockMovementId,
      complaintId,
      reasonCodeId,
      deliveryId,
      syncMutationId,
      vehicleId,
      routeTemplateId,
      capacityFactorId,
      taskId,
      alertId,
      objectionCardId,
      kpiSnapshotId,
      forecastModelId,
      churnScoreId,
    };
  };

  return { a: await build(1, "a"), b: await build(2, "b") };
}
