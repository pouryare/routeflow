-- Up Migration
-- The owner turns step-up codes on once the managers have enrolled an authenticator, so switching the
-- feature on never locks anybody out of an action they had no way to confirm yet. A constant default:
-- nothing is rewritten.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN step_up_required boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE organizations DROP COLUMN step_up_required;
