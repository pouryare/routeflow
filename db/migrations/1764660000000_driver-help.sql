-- Up Migration
-- rf: expand-only
-- Batch H: a driver's «نیاز به کمک» tap reaches the owner and the group's managers as a CRITICAL push.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

INSERT INTO notification_types (organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at, default_push, default_telegram)
VALUES (NULL, 'driver.help', 'راننده کمک می‌خواهد', 'delivery', 'directed', 'CRITICAL', 'entity', 1, '2026-11-14T00:00:00.000Z', '2026-11-14T00:00:00.000Z', 1, 1);

-- Down Migration
DELETE FROM notification_types WHERE code = 'driver.help' AND organization_id IS NULL;
