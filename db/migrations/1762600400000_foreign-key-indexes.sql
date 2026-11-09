-- Up Migration
-- rf: expand-only
-- Indexes for the foreign keys the app actually uses. Of 162 single-column foreign keys with no
-- index of their own, most point at users, groups or organizations, and their rows are found
-- through company-first indexes. Those cost nothing until a parent row is deleted, and the app
-- hardly deletes (notes/db-index-audit-2026-11-09.md). These ones are used:
--
-- Deleting the parent deletes or clears these rows, so Postgres must find them. Without an index it
-- reads the whole child table, once for each parent row deleted:
--   lead_run_stops, lead_list_items  ON DELETE CASCADE from saved_locations (a pin is removed)
--   product_costs, product_prices    ON DELETE CASCADE from packagings
--   live_connections                 ON DELETE CASCADE from users
--   live_display_keys.created_by     ON DELETE SET NULL from users
-- Queries look these up by that column:
--   lead_run_stops.location_id       "is this pin on another driver's run" (lib/repo/leadRuns.ts)
--   run_draft_stops.order_id         an order leaves every other draft (lib/repo/runDrafts.ts)
--   delivery_lines.order_line_id     delivered quantity per order line (lib/repo/deliveries.ts)
--   delivery_runs (organization_id, run_date)  the owner's and manager's run lists. delivery_runs
--                                    had no company index: 293 full reads in one walk through the app.
-- Built in the migration transaction, not CONCURRENTLY: the tables are small (no real users yet) and
-- lock_timeout stops it from waiting behind traffic.
-- squawk-ignore-file require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE INDEX ix_lead_run_stops_location ON lead_run_stops (location_id);
CREATE INDEX ix_lead_list_items_location ON lead_list_items (location_id);
CREATE INDEX ix_product_costs_packaging ON product_costs (packaging_id);
CREATE INDEX ix_product_prices_packaging ON product_prices (packaging_id);
CREATE INDEX ix_live_connections_user ON live_connections (user_id);
CREATE INDEX ix_live_display_keys_created_by ON live_display_keys (created_by);
CREATE INDEX ix_run_draft_stops_order ON run_draft_stops (order_id);
CREATE INDEX ix_delivery_lines_order_line ON delivery_lines (order_line_id);
CREATE INDEX ix_delivery_runs_org_date ON delivery_runs (organization_id, run_date);

-- Down Migration
DROP INDEX IF EXISTS ix_delivery_runs_org_date;
DROP INDEX IF EXISTS ix_delivery_lines_order_line;
DROP INDEX IF EXISTS ix_run_draft_stops_order;
DROP INDEX IF EXISTS ix_live_display_keys_created_by;
DROP INDEX IF EXISTS ix_live_connections_user;
DROP INDEX IF EXISTS ix_product_prices_packaging;
DROP INDEX IF EXISTS ix_product_costs_packaging;
DROP INDEX IF EXISTS ix_lead_list_items_location;
DROP INDEX IF EXISTS ix_lead_run_stops_location;
