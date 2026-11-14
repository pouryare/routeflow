-- Up Migration
-- rf: expand-only
-- F64 first slice: a company minimum for an order's total (0 = off, the default). An order below it is saved only with a reason,
-- kept on the order so the owner can read why small orders were let through.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations ADD COLUMN min_order_toman bigint NOT NULL DEFAULT 0 CHECK (min_order_toman BETWEEN 0 AND 100000000000);
CREATE TRIGGER audit_organizations_min_order AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.min_order_toman IS DISTINCT FROM NEW.min_order_toman) EXECUTE FUNCTION rf_audit('min_order_toman');
ALTER TABLE orders ADD COLUMN below_min_reason text CHECK (below_min_reason IS NULL OR char_length(below_min_reason) <= 100);

-- Down Migration
ALTER TABLE orders DROP COLUMN below_min_reason;
DROP TRIGGER audit_organizations_min_order ON organizations;
ALTER TABLE organizations DROP COLUMN min_order_toman;
