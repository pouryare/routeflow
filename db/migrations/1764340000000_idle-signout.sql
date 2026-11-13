-- Up Migration
-- rf: expand-only
-- E17: sign out after idle hours per role. users.last_active_at is touched at most every few minutes; the rule is a
-- small JSON map on the company ({"owner": 12}); a role not in it never signs out for being idle.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN last_active_at text;
ALTER TABLE organizations ADD COLUMN idle_signout_json text;

CREATE TRIGGER audit_organizations_idle AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.idle_signout_json IS DISTINCT FROM NEW.idle_signout_json) EXECUTE FUNCTION rf_audit('idle_signout_json');

-- Down Migration
DROP TRIGGER audit_organizations_idle ON organizations;
ALTER TABLE organizations DROP COLUMN idle_signout_json;
ALTER TABLE users DROP COLUMN last_active_at;
