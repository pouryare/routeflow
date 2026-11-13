-- Up Migration
-- rf: expand-only
-- F82: a manager sent on leave can name a colleague who decides their group's approvals until the leave ends.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN leave_delegate_id bigint REFERENCES users(id);

-- Down Migration
ALTER TABLE users DROP COLUMN leave_delegate_id;
