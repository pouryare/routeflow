-- Up Migration
-- rf: expand-only
-- An event is a fact saved with the change it describes; these columns make the reaction to it
-- retryable (docs/plans/event-architecture-2026-11-12.md E2). `pending` is true from the insert until the
-- rule engine has run for the event. It defaults to false, so every row that exists today, and every row
-- the previous release writes, counts as handled and is never run a second time.
-- squawk-ignore-file ban-drop-column, require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE events ADD COLUMN pending boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN attempts bigint NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN next_try_at text;
ALTER TABLE events ADD COLUMN last_error text;
ALTER TABLE events_archive ADD COLUMN pending boolean NOT NULL DEFAULT false;
ALTER TABLE events_archive ADD COLUMN attempts bigint NOT NULL DEFAULT 0;
ALTER TABLE events_archive ADD COLUMN next_try_at text;
ALTER TABLE events_archive ADD COLUMN last_error text;

CREATE INDEX ix_events_pending ON events (id) WHERE pending;

-- Down Migration
DROP INDEX IF EXISTS ix_events_pending;
ALTER TABLE events_archive DROP COLUMN last_error, DROP COLUMN next_try_at, DROP COLUMN attempts, DROP COLUMN pending;
ALTER TABLE events DROP COLUMN last_error, DROP COLUMN next_try_at, DROP COLUMN attempts, DROP COLUMN pending;
