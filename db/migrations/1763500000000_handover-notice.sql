-- Up Migration
-- rf: expand-only
-- E2: the person who is given a colleague's customers and open tasks (F59) is told with a push, the same way a
-- single task given to them is. One notification type and the rule that turns the records.handed_over event into it.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

INSERT INTO notification_types (organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at, default_push, default_telegram)
VALUES (NULL, 'records.handed_over', 'کارهای یک همکار به شما سپرده شد', 'task', 'directed', 'HIGH', 'entity', 1, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', 1, 1);

INSERT INTO rules (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json, cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
VALUES (NULL, 'notify_records_handed_over', 'اعلان: کارهای یک همکار به شما سپرده شد', 'records.handed_over', NULL, 'notify', '{"notification_type":"records.handed_over"}', 1, NULL, NULL, 1, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');

-- Down Migration
DELETE FROM rules WHERE code = 'notify_records_handed_over' AND organization_id IS NULL;
DELETE FROM notification_types WHERE code = 'records.handed_over' AND organization_id IS NULL;
