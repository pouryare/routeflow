-- Up Migration
-- rf: expand-only
-- The bell list asks for one person's newest notifications (lib/repo/notifications.ts, ORDER BY
-- created_at DESC, id DESC LIMIT n). ix_notifications_feed puts read_at before created_at, so
-- Postgres read every row of that person and sorted them: 45 ms for 25,000 rows, on every page.
-- In this order it reads the first n and stops: 0.07 ms (notes/db-index-audit-2026-11-09.md).
-- ix_notifications_feed stays: the unread count and "mark all read" filter on read_at IS NULL.
-- Built in the migration transaction, not CONCURRENTLY: the tables are small (no real users yet)
-- and lock_timeout below stops it from waiting behind traffic.
-- squawk-ignore-file require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE INDEX ix_notifications_newest ON notifications (organization_id, user_id, created_at DESC, id DESC);

-- Down Migration
DROP INDEX IF EXISTS ix_notifications_newest;
