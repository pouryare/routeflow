-- Up Migration
-- rf: expand-only
-- F6 first slice: the newest position of each driver whose run is in progress. One row per driver, no trail.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-table, prefer-bigint-over-int, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE van_positions (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  user_id bigint NOT NULL REFERENCES users(id),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m integer,
  recorded_at text NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE van_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON van_positions USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON van_positions TO routeflow_app;

-- Down Migration
DROP TABLE van_positions;
