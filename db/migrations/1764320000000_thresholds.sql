-- Up Migration
-- rf: expand-only
-- D30: the numbers that were fixed in code, now set by the owner per company. Defaults are the old fixed values.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations
  ADD COLUMN stalled_order_days integer NOT NULL DEFAULT 2 CHECK (stalled_order_days BETWEEN 1 AND 60),
  ADD COLUMN quiet_customer_days integer NOT NULL DEFAULT 45 CHECK (quiet_customer_days BETWEEN 7 AND 365),
  ADD COLUMN data_ageing_days integer NOT NULL DEFAULT 7 CHECK (data_ageing_days BETWEEN 1 AND 90),
  ADD COLUMN data_stale_days integer NOT NULL DEFAULT 14 CHECK (data_stale_days BETWEEN 2 AND 180),
  ADD COLUMN duplicate_order_hours integer NOT NULL DEFAULT 24 CHECK (duplicate_order_hours BETWEEN 1 AND 168);

-- Who changed which number and when (E6): a second trigger beside audit_organizations_update, for the new columns only.
CREATE TRIGGER audit_organizations_thresholds AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.stalled_order_days IS DISTINCT FROM NEW.stalled_order_days OR OLD.quiet_customer_days IS DISTINCT FROM NEW.quiet_customer_days OR OLD.data_ageing_days IS DISTINCT FROM NEW.data_ageing_days OR OLD.data_stale_days IS DISTINCT FROM NEW.data_stale_days OR OLD.duplicate_order_hours IS DISTINCT FROM NEW.duplicate_order_hours) EXECUTE FUNCTION rf_audit('stalled_order_days', 'quiet_customer_days', 'data_ageing_days', 'data_stale_days', 'duplicate_order_hours');

-- Down Migration
DROP TRIGGER audit_organizations_thresholds ON organizations;
ALTER TABLE organizations
  DROP COLUMN stalled_order_days, DROP COLUMN quiet_customer_days, DROP COLUMN data_ageing_days,
  DROP COLUMN data_stale_days, DROP COLUMN duplicate_order_hours;
