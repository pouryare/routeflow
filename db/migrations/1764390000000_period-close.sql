-- Up Migration
-- rf: expand-only
-- squawk-ignore-file ban-drop-column, require-lock-timeout, require-statement-timeout
-- A2: closing and reopening a month. The reason for a reopening is kept on the period; both changes go to the audit record.
ALTER TABLE fiscal_periods ADD COLUMN reopen_reason text;
ALTER TABLE fiscal_periods ADD COLUMN reopened_at text;
ALTER TABLE fiscal_periods ADD COLUMN reopened_by bigint;
CREATE TRIGGER audit_fiscal_periods AFTER UPDATE ON fiscal_periods FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.reopen_reason IS DISTINCT FROM NEW.reopen_reason) EXECUTE FUNCTION rf_audit('status', 'reopen_reason');

-- Down Migration
DROP TRIGGER audit_fiscal_periods ON fiscal_periods;
ALTER TABLE fiscal_periods DROP COLUMN reopened_by;
ALTER TABLE fiscal_periods DROP COLUMN reopened_at;
ALTER TABLE fiscal_periods DROP COLUMN reopen_reason;
