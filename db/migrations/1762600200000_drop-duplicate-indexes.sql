-- Up Migration
-- rf: contract
-- Six plain indexes repeat the first columns of a unique index on the same table. The unique index
-- answers every query the plain one can, so the copy only slows down writes and takes disk space
-- (notes/db-index-audit-2026-11-09.md). For example, deliveries_order_id_seq_key is
-- UNIQUE (order_id, seq), so idx_deliveries_order ON (order_id, seq) is the same index twice.
-- contract: it drops indexes. The previous release reads through the unique twins all the same.
-- Dropped in the migration transaction, not CONCURRENTLY: the tables are small (no real users yet)
-- and lock_timeout stops it from waiting behind traffic.
-- squawk-ignore-file require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP INDEX IF EXISTS idx_deliveries_order;        -- = deliveries_order_id_seq_key (order_id, seq)
DROP INDEX IF EXISTS idx_delivery_runs_driver;    -- = delivery_runs_driver_user_id_run_date_key (driver_user_id, run_date)
DROP INDEX IF EXISTS ix_lead_import_items_job;    -- = lead_import_items_job_id_ordinal_key (job_id, ordinal)
DROP INDEX IF EXISTS idx_run_facility_stops_run;  -- = run_facility_stops_run_id_role_key (run_id, role)
DROP INDEX IF EXISTS idx_districts_name;          -- leading column of districts_name_level_parent_name_key
DROP INDEX IF EXISTS idx_packagings_product;      -- leading column of packagings_product_id_name_key

-- Down Migration
CREATE INDEX IF NOT EXISTS idx_packagings_product ON packagings (product_id);
CREATE INDEX IF NOT EXISTS idx_districts_name ON districts (name);
CREATE INDEX IF NOT EXISTS idx_run_facility_stops_run ON run_facility_stops (run_id, role);
CREATE INDEX IF NOT EXISTS ix_lead_import_items_job ON lead_import_items (job_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_driver ON delivery_runs (driver_user_id, run_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries (order_id, seq);
