-- Up Migration
-- rf: expand-only
-- S19: one push to the assignee a few minutes before a task with a set time (default 10). The owner
-- changes the minutes; each person can switch the type off in their notification settings.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN task_push_minutes bigint NOT NULL DEFAULT 10;

INSERT INTO notification_types (organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at, default_push, default_telegram)
VALUES (NULL, 'task.due_soon', 'کار ساعت‌دار نزدیک است', 'task', 'directed', 'HIGH', 'entity', 1, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z', 1, 0);

INSERT INTO rules (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json, cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
VALUES (NULL, 'notify_task_due_soon', 'اعلان: کار ساعت‌دار', 'sweep', NULL, 'notify', '{"notification_type":"task.due_soon"}', 1440, NULL, NULL, 1, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z');

-- Down Migration
DELETE FROM rules WHERE organization_id IS NULL AND code = 'notify_task_due_soon';
DELETE FROM notification_types WHERE organization_id IS NULL AND code = 'task.due_soon';
ALTER TABLE organizations DROP COLUMN task_push_minutes;
