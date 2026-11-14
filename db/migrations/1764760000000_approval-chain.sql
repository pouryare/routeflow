-- Up Migration
-- rf: expand-only
-- F129 first slice: a credit, value or hold approval bigger than a company limit needs two steps: the group manager says «تأیید و ارجاع»,
-- then the owner decides. 0 means off (the default), so nothing changes until the owner sets a number.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations ADD COLUMN approval_owner_limit_toman bigint NOT NULL DEFAULT 0 CHECK (approval_owner_limit_toman BETWEEN 0 AND 100000000000);
CREATE TRIGGER audit_organizations_owner_limit AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.approval_owner_limit_toman IS DISTINCT FROM NEW.approval_owner_limit_toman) EXECUTE FUNCTION rf_audit('approval_owner_limit_toman');

ALTER TABLE credit_approvals ADD COLUMN manager_ok_by bigint REFERENCES users(id);
ALTER TABLE credit_approvals ADD COLUMN manager_ok_at text;

-- Down Migration
ALTER TABLE credit_approvals DROP COLUMN manager_ok_at;
ALTER TABLE credit_approvals DROP COLUMN manager_ok_by;
DROP TRIGGER audit_organizations_owner_limit ON organizations;
ALTER TABLE organizations DROP COLUMN approval_owner_limit_toman;
