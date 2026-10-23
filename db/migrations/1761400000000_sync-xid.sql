-- Up Migration
-- The offline pull's watermark on PostgreSQL (Wave P, phase 3; lib/repo/syncPull.ts).
--
-- On SQLite the watermark is a timestamp, which is safe because SQLite has one writer at a time.
-- PostgreSQL commits concurrently: a transaction that stamped a row at T can commit after a pull
-- has already read past T, and that row would never be sent. So every table the pull reads
-- carries the id of the transaction that last wrote the row, and the watermark is the oldest
-- transaction still running when the pull began (pg_snapshot_xmin). Everything below it has
-- committed or rolled back, so nothing can appear behind the watermark later.
--
-- The column is nullable and filled by a trigger, so adding it rewrites nothing.
-- Only the down migration drops anything, and it undoes exactly this file:
-- squawk-ignore-file ban-drop-column, ban-drop-function

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE FUNCTION rf_stamp_sync_xid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sync_xid := pg_current_xact_id();
  RETURN NEW;
END $$;

ALTER TABLE products ADD COLUMN sync_xid xid8;
CREATE TRIGGER products_sync_xid BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE packagings ADD COLUMN sync_xid xid8;
CREATE TRIGGER packagings_sync_xid BEFORE INSERT OR UPDATE ON packagings FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE product_prices ADD COLUMN sync_xid xid8;
CREATE TRIGGER product_prices_sync_xid BEFORE INSERT OR UPDATE ON product_prices FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE delivery_runs ADD COLUMN sync_xid xid8;
CREATE TRIGGER delivery_runs_sync_xid BEFORE INSERT OR UPDATE ON delivery_runs FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE delivery_stops ADD COLUMN sync_xid xid8;
CREATE TRIGGER delivery_stops_sync_xid BEFORE INSERT OR UPDATE ON delivery_stops FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE lead_run_stops ADD COLUMN sync_xid xid8;
CREATE TRIGGER lead_run_stops_sync_xid BEFORE INSERT OR UPDATE ON lead_run_stops FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE run_facility_stops ADD COLUMN sync_xid xid8;
CREATE TRIGGER run_facility_stops_sync_xid BEFORE INSERT OR UPDATE ON run_facility_stops FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE facilities ADD COLUMN sync_xid xid8;
CREATE TRIGGER facilities_sync_xid BEFORE INSERT OR UPDATE ON facilities FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE run_unload_lines ADD COLUMN sync_xid xid8;
CREATE TRIGGER run_unload_lines_sync_xid BEFORE INSERT OR UPDATE ON run_unload_lines FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE saved_locations ADD COLUMN sync_xid xid8;
CREATE TRIGGER saved_locations_sync_xid BEFORE INSERT OR UPDATE ON saved_locations FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE orders ADD COLUMN sync_xid xid8;
CREATE TRIGGER orders_sync_xid BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE order_lines ADD COLUMN sync_xid xid8;
CREATE TRIGGER order_lines_sync_xid BEFORE INSERT OR UPDATE ON order_lines FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE customers ADD COLUMN sync_xid xid8;
CREATE TRIGGER customers_sync_xid BEFORE INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE deliveries ADD COLUMN sync_xid xid8;
CREATE TRIGGER deliveries_sync_xid BEFORE INSERT OR UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();
ALTER TABLE deleted_rows ADD COLUMN sync_xid xid8;
CREATE TRIGGER deleted_rows_sync_xid BEFORE INSERT OR UPDATE ON deleted_rows FOR EACH ROW EXECUTE FUNCTION rf_stamp_sync_xid();

-- Down Migration
DROP TRIGGER products_sync_xid ON products;
ALTER TABLE products DROP COLUMN sync_xid;
DROP TRIGGER packagings_sync_xid ON packagings;
ALTER TABLE packagings DROP COLUMN sync_xid;
DROP TRIGGER product_prices_sync_xid ON product_prices;
ALTER TABLE product_prices DROP COLUMN sync_xid;
DROP TRIGGER delivery_runs_sync_xid ON delivery_runs;
ALTER TABLE delivery_runs DROP COLUMN sync_xid;
DROP TRIGGER delivery_stops_sync_xid ON delivery_stops;
ALTER TABLE delivery_stops DROP COLUMN sync_xid;
DROP TRIGGER lead_run_stops_sync_xid ON lead_run_stops;
ALTER TABLE lead_run_stops DROP COLUMN sync_xid;
DROP TRIGGER run_facility_stops_sync_xid ON run_facility_stops;
ALTER TABLE run_facility_stops DROP COLUMN sync_xid;
DROP TRIGGER facilities_sync_xid ON facilities;
ALTER TABLE facilities DROP COLUMN sync_xid;
DROP TRIGGER run_unload_lines_sync_xid ON run_unload_lines;
ALTER TABLE run_unload_lines DROP COLUMN sync_xid;
DROP TRIGGER saved_locations_sync_xid ON saved_locations;
ALTER TABLE saved_locations DROP COLUMN sync_xid;
DROP TRIGGER orders_sync_xid ON orders;
ALTER TABLE orders DROP COLUMN sync_xid;
DROP TRIGGER order_lines_sync_xid ON order_lines;
ALTER TABLE order_lines DROP COLUMN sync_xid;
DROP TRIGGER customers_sync_xid ON customers;
ALTER TABLE customers DROP COLUMN sync_xid;
DROP TRIGGER deliveries_sync_xid ON deliveries;
ALTER TABLE deliveries DROP COLUMN sync_xid;
DROP TRIGGER deleted_rows_sync_xid ON deleted_rows;
ALTER TABLE deleted_rows DROP COLUMN sync_xid;
DROP FUNCTION rf_stamp_sync_xid();
