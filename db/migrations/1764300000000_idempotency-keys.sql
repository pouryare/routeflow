-- Up Migration
-- rf: expand-only
-- Z2: a one-time key per money form. The first save with a key stores its answer; a repeat of the same key (a
-- double tap, a retry on a slow phone) gets that answer back and saves nothing new.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE idempotency_keys (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 80),
  user_id bigint NOT NULL REFERENCES users(id),
  path text NOT NULL,
  -- null while the first save is still running
  status integer,
  response_json text,
  created_at text NOT NULL,
  PRIMARY KEY (organization_id, key)
);
CREATE INDEX ix_idempotency_keys_created ON idempotency_keys (created_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON idempotency_keys USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO routeflow_app;

-- Down Migration
DROP TABLE idempotency_keys;
