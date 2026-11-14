-- Up Migration
-- rf: expand-only
-- FB24: the driver who has a pending stop for an order gets one push when a manager or the owner changes it after confirmation.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

INSERT INTO notification_types (organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at, default_push, default_telegram)
VALUES (NULL, 'order.changed', 'سفارش روی مسیر شما تغییر کرد', 'task', 'directed', 'HIGH', 'entity', 1, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', 1, 0);

-- Down Migration
DELETE FROM notification_types WHERE code = 'order.changed' AND organization_id IS NULL;
