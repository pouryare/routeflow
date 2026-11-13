-- Up Migration
-- rf: expand-only
-- Z11: an expense category the owner marks private. Others see its lines with dots and no amount in totals.
-- squawk-ignore-file ban-drop-table, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE private_categories (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  account_id bigint NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (organization_id, account_id)
);

ALTER TABLE private_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON private_categories USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON private_categories TO routeflow_app;

-- Down Migration
DROP TABLE private_categories;
