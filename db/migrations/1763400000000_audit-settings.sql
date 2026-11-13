-- Up Migration
-- rf: expand-only
-- E6: the «who changed what» record also covers access and settings, not only money and customers (plan E4/E6).
-- New triggers on: company settings (discount limits, two-step rule, order prefix, maintenance window, active),
-- groups, the «مربی» and two-step switches of a user, commission rates and storages (never their keys).
-- rf_audit learns that a company row IS its own company (organizations has no organization_id column).
-- squawk-ignore-file ban-drop-table, ban-drop-column, ban-drop-function, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION rf_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  ch jsonb := '{}'::jsonb;
  k text;
  org bigint;
  who text;
  uid bigint;
  imp bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_j := to_jsonb(NEW); END IF;
  FOREACH k IN ARRAY TG_ARGV LOOP
    IF TG_OP = 'UPDATE' THEN
      IF old_j -> k IS DISTINCT FROM new_j -> k THEN
        ch := ch || jsonb_build_object(k, jsonb_build_object('old', old_j -> k, 'new', new_j -> k));
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      ch := ch || jsonb_build_object(k, jsonb_build_object('new', new_j -> k));
    ELSE
      ch := ch || jsonb_build_object(k, jsonb_build_object('old', old_j -> k));
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND ch = '{}'::jsonb THEN RETURN NEW; END IF;

  org := (COALESCE(new_j, old_j) ->> 'organization_id')::bigint;
  IF org IS NULL AND TG_TABLE_NAME = 'order_lines' THEN
    SELECT organization_id INTO org FROM orders WHERE id = (COALESCE(new_j, old_j) ->> 'order_id')::bigint;
  ELSIF org IS NULL AND TG_TABLE_NAME = 'product_prices' THEN
    SELECT organization_id INTO org FROM products WHERE id = (COALESCE(new_j, old_j) ->> 'product_id')::bigint;
  ELSIF org IS NULL AND TG_TABLE_NAME = 'organizations' THEN
    org := (COALESCE(new_j, old_j) ->> 'id')::bigint;
  END IF;
  IF org IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  who := current_setting('rf.actor', true);
  IF who ~ '^[0-9]+(:[0-9]+)?$' THEN
    uid := split_part(who, ':', 1)::bigint;
    imp := NULLIF(split_part(who, ':', 2), '')::bigint;
  END IF;
  INSERT INTO audit_log (organization_id, table_name, row_id, op, changes_json, actor_user_id, impersonated_by, created_at)
  VALUES (org, TG_TABLE_NAME, (COALESCE(new_j, old_j) ->> 'id')::bigint, lower(TG_OP), ch::text, uid, imp,
          to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER audit_organizations_update AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.discount_auto_pass_pct IS DISTINCT FROM NEW.discount_auto_pass_pct OR OLD.discount_commission_pct IS DISTINCT FROM NEW.discount_commission_pct OR OLD.step_up_required IS DISTINCT FROM NEW.step_up_required OR OLD.task_push_minutes IS DISTINCT FROM NEW.task_push_minutes OR OLD.order_prefix IS DISTINCT FROM NEW.order_prefix OR OLD.active IS DISTINCT FROM NEW.active OR OLD.plan IS DISTINCT FROM NEW.plan OR OLD.maintenance_from IS DISTINCT FROM NEW.maintenance_from OR OLD.maintenance_to IS DISTINCT FROM NEW.maintenance_to) EXECUTE FUNCTION rf_audit('name', 'discount_auto_pass_pct', 'discount_commission_pct', 'step_up_required', 'task_push_minutes', 'order_prefix', 'active', 'plan', 'maintenance_from', 'maintenance_to');
CREATE TRIGGER audit_groups_update AFTER UPDATE ON groups FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.active IS DISTINCT FROM NEW.active) EXECUTE FUNCTION rf_audit('name', 'active');
CREATE TRIGGER audit_groups_row AFTER INSERT OR DELETE ON groups FOR EACH ROW EXECUTE FUNCTION rf_audit('name', 'active');
CREATE TRIGGER audit_users_access_update AFTER UPDATE ON users FOR EACH ROW WHEN (OLD.can_teach IS DISTINCT FROM NEW.can_teach OR (OLD.totp_enabled_at IS NULL) IS DISTINCT FROM (NEW.totp_enabled_at IS NULL)) EXECUTE FUNCTION rf_audit('can_teach', 'totp_enabled_at');
CREATE TRIGGER audit_commission_rates_row AFTER INSERT OR DELETE ON commission_rates FOR EACH ROW EXECUTE FUNCTION rf_audit('rate_per_kg_toman', 'urgent_rate_per_kg_toman', 'salesperson_user_id', 'valid_from');
CREATE TRIGGER audit_storages_update AFTER UPDATE ON storages FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.kind IS DISTINCT FROM NEW.kind OR OLD.endpoint IS DISTINCT FROM NEW.endpoint OR OLD.bucket IS DISTINCT FROM NEW.bucket) EXECUTE FUNCTION rf_audit('name', 'kind', 'endpoint', 'bucket');
CREATE TRIGGER audit_storages_row AFTER INSERT OR DELETE ON storages FOR EACH ROW EXECUTE FUNCTION rf_audit('name', 'kind', 'endpoint', 'bucket');

-- Down Migration
DROP TRIGGER IF EXISTS audit_storages_row ON storages;
DROP TRIGGER IF EXISTS audit_storages_update ON storages;
DROP TRIGGER IF EXISTS audit_commission_rates_row ON commission_rates;
DROP TRIGGER IF EXISTS audit_users_access_update ON users;
DROP TRIGGER IF EXISTS audit_groups_row ON groups;
DROP TRIGGER IF EXISTS audit_groups_update ON groups;
DROP TRIGGER IF EXISTS audit_organizations_update ON organizations;
