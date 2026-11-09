-- Up Migration
-- rf: expand-only
-- Old history moves to archive twins instead of being deleted (owner decision 2026-11-09, kept for
-- decisions and future ML). Five log tables grow every day and are read mostly for the last weeks:
--   events, notifications, rule_runs, order_events  -> moved after N months (app_meta
--     'archive_hot_months', set by the platform owner on «وضعیت سامانه», default 12)
--   live_events                                     -> moved after 7 days (its replay window)
-- Orders, payments and the ledger are never archived. Each twin has the same columns in the same
-- order (tests/history-archive-pg.test.ts checks it), no foreign keys (a row is a record of what
-- happened), the same company policy, and only reads and inserts for the app.
-- order_events_all is the one place that reads both halves: an order's timeline from two years ago
-- still shows every step. security_invoker makes the view apply the caller's row-level security.
-- squawk-ignore-file require-concurrent-index-creation, ban-drop-table, ban-drop-view, prefer-robust-stmts

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE events_archive (LIKE events);
ALTER TABLE events_archive ADD PRIMARY KEY (id);
CREATE INDEX ix_events_archive_org_time ON events_archive (organization_id, occurred_at);

CREATE TABLE notifications_archive (LIKE notifications);
ALTER TABLE notifications_archive ADD PRIMARY KEY (id);
CREATE INDEX ix_notifications_archive_user ON notifications_archive (organization_id, user_id, created_at);

CREATE TABLE rule_runs_archive (LIKE rule_runs);
ALTER TABLE rule_runs_archive ADD PRIMARY KEY (id);
CREATE INDEX ix_rule_runs_archive_org_time ON rule_runs_archive (organization_id, fired_at);

CREATE TABLE order_events_archive (LIKE order_events);
ALTER TABLE order_events_archive ADD PRIMARY KEY (id);
CREATE INDEX ix_order_events_archive_order ON order_events_archive (order_id, created_at);

CREATE TABLE live_events_archive (LIKE live_events);
ALTER TABLE live_events_archive ADD PRIMARY KEY (id);
CREATE INDEX ix_live_events_archive_org_time ON live_events_archive (organization_id, created_at);

ALTER TABLE events_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON events_archive USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
ALTER TABLE notifications_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON notifications_archive USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
ALTER TABLE rule_runs_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON rule_runs_archive USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
ALTER TABLE order_events_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON order_events_archive USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
ALTER TABLE live_events_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON live_events_archive USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));

GRANT SELECT, INSERT ON events_archive, notifications_archive, rule_runs_archive, order_events_archive, live_events_archive TO routeflow_app;

CREATE VIEW order_events_all WITH (security_invoker = true) AS
  SELECT * FROM order_events
  UNION ALL
  SELECT * FROM order_events_archive;
GRANT SELECT ON order_events_all TO routeflow_app;

INSERT INTO app_meta (key, value) VALUES ('archive_hot_months', '12') ON CONFLICT (key) DO NOTHING;

-- Down Migration
-- Puts every archived row back in its table, then drops the twins.
INSERT INTO events SELECT * FROM events_archive ON CONFLICT DO NOTHING;
INSERT INTO notifications SELECT * FROM notifications_archive ON CONFLICT DO NOTHING;
INSERT INTO rule_runs SELECT * FROM rule_runs_archive ON CONFLICT DO NOTHING;
INSERT INTO order_events SELECT * FROM order_events_archive ON CONFLICT DO NOTHING;
INSERT INTO live_events OVERRIDING SYSTEM VALUE SELECT * FROM live_events_archive ON CONFLICT DO NOTHING;
DROP VIEW IF EXISTS order_events_all;
DROP TABLE IF EXISTS events_archive, notifications_archive, rule_runs_archive, order_events_archive, live_events_archive;
DELETE FROM app_meta WHERE key = 'archive_hot_months';
