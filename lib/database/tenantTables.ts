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
  "groups",
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
  "payments",
  "parties",
  "shareholdings",
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
] as const satisfies readonly string[];
