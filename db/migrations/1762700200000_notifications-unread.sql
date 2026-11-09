-- Up Migration
-- rf: expand-only
-- The bell's unread count (lib/repo/notifications.ts unreadGroupCount, COUNT(DISTINCT group_key)
-- over a person's unread rows) runs on every page. ix_notifications_feed finds the rows but has to
-- visit the table for group_key: 30 ms for a person with 25,000 unread. Holding only unread rows,
-- with group_key in the index, it is an index-only scan: 7 ms there, and near nothing for the usual
-- handful of unread (index audit, PR #66).
-- Built in the migration transaction, not CONCURRENTLY: the tables are small (no real users yet)
-- and lock_timeout below stops it from waiting behind traffic.
-- squawk-ignore-file require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE INDEX ix_notifications_unread ON notifications (organization_id, user_id, group_key) WHERE read_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS ix_notifications_unread;
