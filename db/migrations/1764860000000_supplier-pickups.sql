-- Up Migration
-- rf: contract
-- F118 first slice: a driver's run can include a pickup at a supplier or factory (a facility), optionally tied to a purchase order.
-- A run may have several pickups, so the one-per-role rule becomes one-per-role-and-place.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, constraint-missing-not-valid, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE run_facility_stops DROP CONSTRAINT run_facility_stops_role_check;
ALTER TABLE run_facility_stops ADD CONSTRAINT run_facility_stops_role_check CHECK (role IN ('load', 'unload', 'pickup'));
ALTER TABLE run_facility_stops DROP CONSTRAINT run_facility_stops_run_id_role_key;
ALTER TABLE run_facility_stops ADD CONSTRAINT run_facility_stops_run_role_facility_key UNIQUE (run_id, role, facility_id);
ALTER TABLE run_facility_stops ADD COLUMN purchase_order_id bigint REFERENCES purchase_orders(id);

-- Down Migration
ALTER TABLE run_facility_stops DROP COLUMN purchase_order_id;
ALTER TABLE run_facility_stops DROP CONSTRAINT run_facility_stops_run_role_facility_key;
DELETE FROM run_facility_stops WHERE role = 'pickup';
ALTER TABLE run_facility_stops ADD CONSTRAINT run_facility_stops_run_id_role_key UNIQUE (run_id, role);
ALTER TABLE run_facility_stops DROP CONSTRAINT run_facility_stops_role_check;
ALTER TABLE run_facility_stops ADD CONSTRAINT run_facility_stops_role_check CHECK (role IN ('load', 'unload'));
