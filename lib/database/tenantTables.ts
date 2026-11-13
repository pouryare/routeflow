/* The tables that carry an organization_id (one row belongs to exactly one company). getDb() adds
 * and backfills the column on each, and tests/tenancy-*.test.ts read this list. Moved out of
 * lib/db.ts, which re-exports it. */
/** Tables whose rows belong to exactly one tenant and are scoped by organization_id.
 *
 *  A table not on this list and not in the exemption set in
 *  tests/tenancy-schema.test.ts fails the build. That is deliberate: the failure mode
 *  this list prevents is a table added later with no tenant column, which is readable
 *  by every organisation and looks like nothing at all until a second tenant is on the
 *  system.
 *
 *  Child tables are absent on purpose -- order_lines reaches its tenant through orders,
 *  and a second copy of the answer is a second thing to keep in step. */
export const TENANT_TABLES = [
  "cash_handovers",
  "deposit_slips",
  "payment_promises",
  "van_positions",
  "reconciled_entries",
  "reconciliations",
  "change_requests",
  "supplier_prices",
  "contact_preferences",
  "idempotency_keys",
  "private_categories",
  "problem_reports",
  "groups",
  "company_domains",
  "customers",
  /* districts is deliberately ABSENT: it is shared geography, not tenant data. Tehran's
     22 منطقه are the same for every organisation, and per-tenant copies of the same
     polygons can drift apart until منطقه 14 means two different places. It was in this
     list, which meant the sweeps below re-ALTERed an organization_id onto it and stamped
     it to 1 on every row, every boot. */
  "facilities",
  "saved_locations",
  "lead_import_jobs",
  "lead_import_items",
  "lead_lists",
  "products",
  "orders",
  "purchases",
  "delivery_runs",
  /* "lead_runs" is GONE — folded into delivery_runs by foldLeadRunsIntoDeliveryRuns. Its
     stops live on in `lead_run_stops`, which has no organization_id of its own and is reached
     through delivery_runs, so there is nothing here for the sweep below to stamp. Leaving the
     name in the list would ALTER a column onto a table that no longer exists. */
  "lead_visit_activities",
  /* A draft belongs to a PERSON first, so it carries organization_id AND user_id -- and is
     therefore a tenant table in its own right rather than reaching a tenant through a run.
     It is here because it genuinely needs stamping, not because every table reaches one. */
  "run_drafts",
  "commission_rates",
  "commission_tiers",
  "commission_payments",
  "driver_commission_rates",
  "driver_commission_payments",
  "manager_commission_overrides",
  "manager_commission_payments",
  "representative_profiles",
  "credit_approvals",
  "order_discounts",
  "discount_commission_shares",
  "payments",
  "parties",
  "shareholdings",
  "shared_cost_rules",
  "profit_splits",
  "profit_split_lines",
  "profit_split_groups",
  "cheques",
  "batches",
  "stock_movements",
  "delivery_line_batches",
  "quality_complaints",
  "reason_codes",
  "deliveries",
  "stock_reservations",
  "sync_mutations",
  "deleted_rows",
  "vehicles",
  "route_templates",
  "capacity_factors",
  "events",
  "tasks",
  "alerts",
  "rules",
  "rule_runs",
  "targets",
  "objection_cards",
  "lesson_progress",
  "kpi_definitions",
  "kpi_snapshots",
  "seasonal_factors",
  "forecast_models",
  "forecasts",
  "churn_models",
  "churn_scores",
  "task_recurrences",
  "notification_types",
  "notifications",
  "contacts",
  "activities",
  "customer_tags",
  "fiscal_periods",
  "journals",
  "expense_receipts",
  "crm_not_duplicates",
  "ledger_entries",
  /* The legacy purchase-history import. It predates tenancy and used to be matched to customers by business
     name alone, so two companies with a same-named customer saw each other's history. Existing rows are
     stamped to the original company by the sweep. */
  "sales",
  "suppliers",
  "login_events",
  /* Company storages (docs/storage.md). */
  "storages",
  "storage_rules",
  "stored_files",
  "storage_moves",
  "storage_jobs",
  "storage_events",
  /* Z9: where the phone was when a payment or expense was entered. */
  "entry_places",
  "tutorial_assignments",
  "tutorial_counts",
  /* Live updates (issue #58): the event log every open screen reads, and who was seen online. */
  "live_events",
  "live_presence",
  "live_latest",
  "live_viewing",
  "live_connections",
  "live_display_keys",
  /* Archive twins of the log tables (db/migrations/1762700000000_history-archive.sql): old history,
     kept, read by reports and the order timeline. order_events_archive is exempt like order_events. */
  "events_archive",
  "notifications_archive",
  "rule_runs_archive",
  "live_events_archive",
  /* Saved daily sales totals and the days marked for a recount (lib/repo/salesDaily.ts). */
  "sales_daily",
  "sales_daily_products",
  "sales_daily_marks",
  /* The shared «who changed what» record, filled by triggers (docs/plans/event-architecture-2026-11-12.md E4). */
  "audit_log",
  /* Company lessons and the pictures inside them and on products (AC1, VC1). */
  "academy_categories",
  "academy_lessons",
  "content_images",
  /* Customers lent to a colleague for a number of days (T13, lib/repo/handover.ts). */
  "customer_loans",
  /* The company's things and who holds them (F140, lib/repo/assets.ts). */
  "assets",
] as const satisfies readonly string[];
