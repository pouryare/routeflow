-- Up Migration
-- rf: expand-only
-- S23: a person on leave. `leave_until` is the last day they are away (a Tehran date, YYYY-MM-DD); empty means at work.
-- Lists that offer "who should get this customer" skip people on leave, and the users page shows who is away and what
-- they still hold, so the owner can cover it (handover, F59).
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

ALTER TABLE users ADD COLUMN leave_until text;
ALTER TABLE users ADD COLUMN leave_reason text;

-- Down Migration
ALTER TABLE users DROP COLUMN leave_reason;
ALTER TABLE users DROP COLUMN leave_until;
