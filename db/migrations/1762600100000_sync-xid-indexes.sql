-- Up Migration
-- rf: contract
-- The offline pull asks each table for the rows changed since the phone's watermark
-- (lib/repo/syncPull.ts). It wrote COALESCE(sync_xid, '0') >= watermark, and an index cannot serve
-- a column wrapped in a function. So every pull read every order and customer of the company: 28 ms a
-- table with 34,000 orders, even when nothing had changed. Now it is 0.05 ms
-- (notes/db-index-audit-2026-11-09.md).
--
-- So: a row from before sync_xid existed gets '0' instead of NULL, which is what the COALESCE meant.
-- (The trigger stamps the current transaction instead, so a phone gets those rows once more: harmless,
-- because it upserts by id.) New rows already get the trigger's stamp. The '0' default covers rows
-- written with triggers off, as the test fixtures do. The pull then compares sync_xid directly, and
-- these indexes find the changed rows. The pull's other tables are read by run or order id, and their
-- own indexes already cover that.
-- contract: it changes existing rows, though only from NULL to a stamp the old release reads the same way.
-- Built in the migration transaction, not CONCURRENTLY: the tables are small (no real users yet) and
-- lock_timeout stops it from waiting behind traffic.
-- The down migration only removes the defaults this file adds.
-- squawk-ignore-file require-concurrent-index-creation, require-concurrent-index-deletion, ban-drop-default
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE products ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE products SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE packagings ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE packagings SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE product_prices ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE product_prices SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE delivery_runs ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE delivery_runs SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE delivery_stops ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE delivery_stops SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE lead_run_stops ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE lead_run_stops SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE run_facility_stops ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE run_facility_stops SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE facilities ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE facilities SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE run_unload_lines ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE run_unload_lines SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE saved_locations ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE saved_locations SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE orders ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE orders SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE order_lines ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE order_lines SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE customers ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE customers SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE deliveries ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE deliveries SET sync_xid = '0' WHERE sync_xid IS NULL;
ALTER TABLE deleted_rows ALTER COLUMN sync_xid SET DEFAULT '0';
UPDATE deleted_rows SET sync_xid = '0' WHERE sync_xid IS NULL;

CREATE INDEX ix_orders_sync_xid ON orders (sync_xid);
CREATE INDEX ix_customers_sync_xid ON customers (sync_xid);
CREATE INDEX ix_deleted_rows_sync_xid ON deleted_rows (organization_id, sync_xid);

-- Down Migration
DROP INDEX IF EXISTS ix_deleted_rows_sync_xid;
DROP INDEX IF EXISTS ix_customers_sync_xid;
DROP INDEX IF EXISTS ix_orders_sync_xid;
ALTER TABLE products ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE packagings ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE product_prices ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE delivery_runs ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE delivery_stops ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE lead_run_stops ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE run_facility_stops ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE facilities ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE run_unload_lines ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE saved_locations ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE orders ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE order_lines ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE customers ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE deliveries ALTER COLUMN sync_xid DROP DEFAULT;
ALTER TABLE deleted_rows ALTER COLUMN sync_xid DROP DEFAULT;
