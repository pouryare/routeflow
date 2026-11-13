-- Up Migration
-- rf: expand-only
-- A8: the days around an order's due date on which its rep gets a reminder task, e.g. "-3,0,3".
-- squawk-ignore-file ban-drop-column, require-lock-timeout, require-statement-timeout
ALTER TABLE organizations ADD COLUMN due_reminder_days text;

-- Down Migration
ALTER TABLE organizations DROP COLUMN due_reminder_days;
