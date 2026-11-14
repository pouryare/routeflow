-- Up Migration
-- rf: expand-only
-- F76: an order whose total passes a limit kept on the company waits for a manager's approval, in the
-- same inbox as credit approvals. 0 means off (the default), so nothing changes until the owner sets a number.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, ban-drop-table, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations ADD COLUMN order_approval_limit_toman bigint NOT NULL DEFAULT 0 CHECK (order_approval_limit_toman BETWEEN 0 AND 100000000000);
CREATE TRIGGER audit_organizations_order_approval AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.order_approval_limit_toman IS DISTINCT FROM NEW.order_approval_limit_toman) EXECUTE FUNCTION rf_audit('order_approval_limit_toman');

ALTER TABLE credit_approvals ADD COLUMN kind text NOT NULL DEFAULT 'credit' CHECK (kind IN ('credit', 'value'));

-- Down Migration
ALTER TABLE credit_approvals DROP COLUMN kind;
DROP TRIGGER audit_organizations_order_approval ON organizations;
ALTER TABLE organizations DROP COLUMN order_approval_limit_toman;
