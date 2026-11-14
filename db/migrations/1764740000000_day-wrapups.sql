-- Up Migration
-- rf: expand-only
-- F74: a salesperson taps «روز را بستم» at the end of the day. One row per person per day; nothing reads it yet except the
-- card itself (a manager view is left out on purpose, so it does not feel like surveillance).
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-table, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE day_wrapups (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  user_id bigint NOT NULL REFERENCES users(id),
  day text NOT NULL,
  closed_at text NOT NULL,
  PRIMARY KEY (organization_id, user_id, day)
);
ALTER TABLE day_wrapups ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON day_wrapups USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON day_wrapups TO routeflow_app;

-- Down Migration
DROP TABLE day_wrapups;
