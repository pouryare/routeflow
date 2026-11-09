-- Up Migration
-- rf: expand-only
-- Live updates over server-sent events (issue #58; docs/decisions.md 10.7).
--
-- live_events is the log every open screen reads from. A phone that lost signal reconnects with
-- the last id it saw and gets everything after it, so the ids must appear in the order their
-- transactions COMMIT, not the order they were handed out: two writers that took ids 101 and 102,
-- where 102 committed first, would let a phone see 102, drop, come back "after 102" and never get
-- 101. rf_live_publish() therefore takes one transaction-level lock before it takes an id, so the
-- next writer waits until this one has committed. shortcut: one lock for every company, held to the
-- end of the writer's transaction; fine for one company's staff, switch to an xid8 watermark (as
-- the offline pull does, 1761400000000_sync-xid.sql) if writers ever queue on it.
--
-- Each row names who may receive it: its company, and optionally a list of users and/or roles.
-- The writer decides that with the app's own permission code; the stream only compares.
--
-- live_presence is "last seen" per person, refreshed by each open stream. It is UNLOGGED: after a
-- crash it comes back empty, which is the truth anyway.
--
-- users_live_kick tells every app server, on commit, that a person was deactivated or signed out
-- everywhere (token_version), so their open streams close at once instead of at the next check.
-- squawk-ignore-file ban-drop-table, ban-drop-function

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE live_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  topic text NOT NULL CHECK (topic ~ '^[a-z0-9_.:-]{1,80}$'),
  audience_users bigint[],
  audience_roles text[],
  data_json text CHECK (data_json IS NULL OR length(data_json) <= 4000),
  -- The record it is about, when it is about one: the stream asks the same question the record's
  -- own list asks (may this person see order 1042?) before sending it (lib/live/visibility.ts).
  entity_type text CHECK (entity_type IS NULL OR entity_type IN ('order', 'run', 'customer')),
  entity_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_events_org ON live_events (organization_id, id);
CREATE INDEX live_events_created ON live_events (created_at);

ALTER TABLE live_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_events USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, DELETE ON live_events TO routeflow_app;

CREATE UNLOGGED TABLE live_presence (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  last_seen timestamptz NOT NULL
);
CREATE INDEX live_presence_org ON live_presence (organization_id, last_seen);

ALTER TABLE live_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_presence USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON live_presence TO routeflow_app;

-- One event, in commit order; returns its id. The lock comes before the id on purpose (see above).
CREATE FUNCTION rf_live_publish(org bigint, topic text, users bigint[], roles text[], data text,
                                etype text DEFAULT NULL, eid bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE new_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(7421001);
  INSERT INTO live_events (organization_id, topic, audience_users, audience_roles, data_json, entity_type, entity_id)
    VALUES (org, topic, users, roles, data, etype, eid)
    RETURNING id INTO new_id;
  PERFORM pg_notify('rf_live', new_id::text);
  RETURN new_id;
END $$;

-- A new notification reaches its person's open bell at once, whichever of the places that write
-- notifications wrote it. One event per company per statement, naming everyone it was for.
CREATE FUNCTION rf_live_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT organization_id, array_agg(DISTINCT user_id) AS users FROM new_rows GROUP BY organization_id LOOP
    PERFORM rf_live_publish(r.organization_id, 'notifications', r.users, NULL, NULL);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER notifications_live AFTER INSERT ON notifications
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION rf_live_notifications();

-- Orders, runs and customers changed by anyone reach the open lists at once (idea L1, borrowed from
-- Supabase's broadcast-from-database): one small event per row, {id, status}, naming the record so
-- the stream checks who may see it. A statement that changes more than 200 rows (an import, a
-- nightly job) sends one {"bulk":true} event instead, and the screens simply refetch.
-- TG_ARGV: the topic, then the record type.
CREATE FUNCTION rf_live_rows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; n bigint;
BEGIN
  SELECT count(*) INTO n FROM changed;
  IF n > 200 THEN
    FOR r IN SELECT DISTINCT organization_id FROM changed WHERE organization_id IS NOT NULL LOOP
      PERFORM rf_live_publish(r.organization_id, TG_ARGV[0], NULL, NULL, '{"bulk":true}');
    END LOOP;
    RETURN NULL;
  END IF;
  FOR r IN SELECT c.organization_id, c.id, to_jsonb(c) ->> 'status' AS status
             FROM changed c WHERE c.organization_id IS NOT NULL ORDER BY c.id LOOP
    PERFORM rf_live_publish(r.organization_id, TG_ARGV[0], NULL, NULL,
      json_build_object('id', r.id, 'status', r.status)::text, TG_ARGV[1], r.id);
  END LOOP;
  RETURN NULL;
END $$;
-- A transition table serves one event per trigger, so inserts and updates each get their own.
CREATE TRIGGER orders_live_ins AFTER INSERT ON orders
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION rf_live_rows('orders', 'order');
CREATE TRIGGER orders_live_upd AFTER UPDATE ON orders
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION rf_live_rows('orders', 'order');
CREATE TRIGGER delivery_runs_live_ins AFTER INSERT ON delivery_runs
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION rf_live_rows('runs', 'run');
CREATE TRIGGER delivery_runs_live_upd AFTER UPDATE ON delivery_runs
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION rf_live_rows('runs', 'run');
CREATE TRIGGER customers_live_ins AFTER INSERT ON customers
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION rf_live_rows('customers', 'customer');
CREATE TRIGGER customers_live_upd AFTER UPDATE ON customers
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION rf_live_rows('customers', 'customer');

CREATE FUNCTION rf_live_kick() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_version IS DISTINCT FROM OLD.token_version OR NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM pg_notify('rf_live_kick', NEW.id::text);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER users_live_kick AFTER UPDATE OF token_version, active ON users
  FOR EACH ROW EXECUTE FUNCTION rf_live_kick();

-- Down Migration
DROP TRIGGER IF EXISTS customers_live_upd ON customers;
DROP TRIGGER IF EXISTS customers_live_ins ON customers;
DROP TRIGGER IF EXISTS delivery_runs_live_upd ON delivery_runs;
DROP TRIGGER IF EXISTS delivery_runs_live_ins ON delivery_runs;
DROP TRIGGER IF EXISTS orders_live_upd ON orders;
DROP TRIGGER IF EXISTS orders_live_ins ON orders;
DROP FUNCTION IF EXISTS rf_live_rows();
DROP TRIGGER IF EXISTS users_live_kick ON users;
DROP FUNCTION IF EXISTS rf_live_kick();
DROP TRIGGER IF EXISTS notifications_live ON notifications;
DROP FUNCTION IF EXISTS rf_live_notifications();
DROP FUNCTION IF EXISTS rf_live_publish(bigint, text, bigint[], text[], text, text, bigint);
DROP TABLE IF EXISTS live_presence;
DROP TABLE IF EXISTS live_events;
