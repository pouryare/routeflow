-- Up Migration
-- rf: expand-only
-- S6: how a new lead that nobody chose an owner for is handed out inside a group: left in the group pool (the
-- default, as before), one person after another, or to whoever has the fewest open leads. People on leave (S23) are skipped.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

ALTER TABLE groups ADD COLUMN assign_mode text NOT NULL DEFAULT 'pool' CHECK (assign_mode IN ('pool', 'round_robin', 'least_open'));
-- The person who got the last lead in round-robin mode.
ALTER TABLE groups ADD COLUMN last_assigned_user_id bigint REFERENCES users(id);

-- Down Migration
ALTER TABLE groups DROP COLUMN last_assigned_user_id;
ALTER TABLE groups DROP COLUMN assign_mode;
