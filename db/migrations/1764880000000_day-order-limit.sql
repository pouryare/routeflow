-- Up Migration
-- rf: expand-only
-- FB35 first slice: the most orders the company takes for one delivery day (0 = no limit, the default).
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations ADD COLUMN day_order_limit bigint NOT NULL DEFAULT 0 CHECK (day_order_limit BETWEEN 0 AND 1000);
CREATE TRIGGER audit_organizations_day_order_limit AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.day_order_limit IS DISTINCT FROM NEW.day_order_limit) EXECUTE FUNCTION rf_audit('day_order_limit');

-- Down Migration
DROP TRIGGER audit_organizations_day_order_limit ON organizations;
ALTER TABLE organizations DROP COLUMN day_order_limit;
