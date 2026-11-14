-- Up Migration
-- rf: expand-only
-- F64 first slice: a company minimum for an order's total (0 = off, the default). An order below it is saved only with a reason,
-- kept on the order so the owner can read why small orders were let through.
-- F114 first slice: carton_nudge_percent, how close below a bigger pack the order form says «N more complete a carton» (0 = off).
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations ADD COLUMN min_order_toman bigint NOT NULL DEFAULT 0 CHECK (min_order_toman BETWEEN 0 AND 100000000000);
CREATE TRIGGER audit_organizations_min_order AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.min_order_toman IS DISTINCT FROM NEW.min_order_toman) EXECUTE FUNCTION rf_audit('min_order_toman');
ALTER TABLE organizations ADD COLUMN carton_nudge_percent bigint NOT NULL DEFAULT 0 CHECK (carton_nudge_percent BETWEEN 0 AND 50);
CREATE TRIGGER audit_organizations_carton_nudge AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.carton_nudge_percent IS DISTINCT FROM NEW.carton_nudge_percent) EXECUTE FUNCTION rf_audit('carton_nudge_percent');
ALTER TABLE orders ADD COLUMN below_min_reason text CHECK (below_min_reason IS NULL OR char_length(below_min_reason) <= 100);

-- Down Migration
DROP TRIGGER audit_organizations_carton_nudge ON organizations;
ALTER TABLE organizations DROP COLUMN carton_nudge_percent;
ALTER TABLE orders DROP COLUMN below_min_reason;
DROP TRIGGER audit_organizations_min_order ON organizations;
ALTER TABLE organizations DROP COLUMN min_order_toman;
