-- Up Migration
-- rf: expand-only
-- AC follow-up: a person whose required company lesson passed its deadline gets one push for it. One notification
-- type; the rules sweep queues the notification itself (lib/repo/academyOverdue.ts), once per person and lesson.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

INSERT INTO notification_types (organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at, default_push, default_telegram)
VALUES (NULL, 'academy.lesson_overdue', 'درس الزامی از مهلتش گذشته', 'task', 'directed', 'NORMAL', 'entity', 1, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', 1, 0);

-- Down Migration
DELETE FROM notification_types WHERE code = 'academy.lesson_overdue' AND organization_id IS NULL;
