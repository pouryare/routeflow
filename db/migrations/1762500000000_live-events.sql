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
-- live_latest, live_viewing and live_connections are UNLOGGED for the same reason; live_display_keys
-- (L9) is an ordinary table, since a TV's link must survive a restart.
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
  -- A key the sender made (a chat message's id on the phone, idea L7): sending the same key again
  -- returns the first event's id instead of storing a second copy.
  client_key text CHECK (client_key IS NULL OR client_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- "key:value" labels a screen can filter on (?tags=district:14, idea L10).
  tags text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_events_org ON live_events (organization_id, id);
CREATE UNIQUE INDEX live_events_client_key ON live_events (organization_id, client_key) WHERE client_key IS NOT NULL;
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

-- The last value of a topic that only its newest value matters for (import progress, a van's
-- position; idea L4): a screen that opens gets it at once instead of waiting for the next change.
-- UNLOGGED and overwritten in place: after a crash it is empty until the next change, which is fine.
CREATE UNLOGGED TABLE live_latest (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  topic text NOT NULL CHECK (topic ~ '^[a-z0-9_.:-]{1,80}$'),
  audience_users bigint[],
  audience_roles text[],
  data_json text CHECK (data_json IS NULL OR length(data_json) <= 4000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, topic)
);
ALTER TABLE live_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_latest USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON live_latest TO routeflow_app;

-- Who has which record open right now (idea L6): "Sara also has order 1042 open". Refreshed every
-- 20 seconds by the open page; a row older than 45 seconds no longer counts.
CREATE UNLOGGED TABLE live_viewing (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL CHECK (entity_type IN ('order', 'run', 'customer')),
  entity_id bigint NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);
CREATE INDEX live_viewing_entity ON live_viewing (organization_id, entity_type, entity_id);
ALTER TABLE live_viewing ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_viewing USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON live_viewing TO routeflow_app;

-- Every open stream, for the owner's "who is connected" page (idea L8): which phone, since when,
-- how far it has got. Each app server writes its own rows and clears them when it starts.
CREATE UNLOGGED TABLE live_connections (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9-]{36}$'),
  organization_id bigint NOT NULL REFERENCES organizations(id),
  user_id bigint REFERENCES users(id) ON DELETE CASCADE, -- null for a display link (L9)
  server text NOT NULL CHECK (length(server) <= 120),
  device text CHECK (device IS NULL OR length(device) <= 200),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_event_id bigint NOT NULL DEFAULT 0
);
CREATE INDEX live_connections_org ON live_connections (organization_id, opened_at);
ALTER TABLE live_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_connections USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON live_connections TO routeflow_app;

-- A read-only link for a screen nobody signs in on, such as a warehouse TV (idea L9): it opens
-- the stream for the listed topics only, and the owner can revoke it. Only a hash of the key is
-- kept, like a password.
CREATE TABLE live_display_keys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  topics text[] NOT NULL CHECK (cardinality(topics) BETWEEN 1 AND 10),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX live_display_keys_org ON live_display_keys (organization_id);
ALTER TABLE live_display_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_display_keys USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE ON live_display_keys TO routeflow_app;

-- One event, in commit order; returns its id. The lock comes before the id on purpose (see above).
-- With a client key that was already used, it returns that event's id and stores nothing: the
-- lock also makes the check-then-insert safe between two senders of the same key.
CREATE FUNCTION rf_live_publish(org bigint, topic text, users bigint[], roles text[], data text,
                                etype text DEFAULT NULL, eid bigint DEFAULT NULL,
                                ckey text DEFAULT NULL, etags text[] DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE new_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(7421001);
  IF ckey IS NOT NULL THEN
    SELECT e.id INTO new_id FROM live_events e WHERE e.organization_id = org AND e.client_key = ckey;
    IF FOUND THEN RETURN new_id; END IF;
  END IF;
  INSERT INTO live_events (organization_id, topic, audience_users, audience_roles, data_json, entity_type, entity_id, client_key, tags)
    VALUES (org, topic, users, roles, data, etype, eid, ckey, etags)
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
DROP FUNCTION IF EXISTS rf_live_publish(bigint, text, bigint[], text[], text, text, bigint, text, text[]);
DROP TABLE IF EXISTS live_display_keys;
DROP TABLE IF EXISTS live_connections;
DROP TABLE IF EXISTS live_viewing;
DROP TABLE IF EXISTS live_latest;
DROP TABLE IF EXISTS live_presence;
DROP TABLE IF EXISTS live_events;
