-- Up Migration
-- rf: expand-only
-- E5: whoever took a payment can void it within this many minutes (0 = only managers void). Owner setting, default 15.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE organizations ADD COLUMN undo_own_minutes bigint NOT NULL DEFAULT 15 CHECK (undo_own_minutes BETWEEN 0 AND 240);
CREATE TRIGGER audit_organizations_undo_window AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.undo_own_minutes IS DISTINCT FROM NEW.undo_own_minutes) EXECUTE FUNCTION rf_audit('undo_own_minutes');

-- Down Migration
DROP TRIGGER audit_organizations_undo_window ON organizations;
ALTER TABLE organizations DROP COLUMN undo_own_minutes;
