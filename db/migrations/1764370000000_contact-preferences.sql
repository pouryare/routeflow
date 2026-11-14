-- Up Migration
-- rf: expand-only
-- S15: per customer, three things the customer asked us not to do: calls, promotional messages, service messages.
-- A row means "off"; it keeps the reason, the day and who switched it. No row means allowed.
-- squawk-ignore-file ban-drop-table, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE contact_preferences (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  customer_id bigint NOT NULL REFERENCES customers(id),
  channel text NOT NULL CHECK (channel IN ('calls', 'promo', 'service')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  set_by bigint NOT NULL REFERENCES users(id),
  set_at text NOT NULL,
  PRIMARY KEY (customer_id, channel)
);
CREATE INDEX ix_contact_preferences_org ON contact_preferences (organization_id);

ALTER TABLE contact_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON contact_preferences USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_preferences TO routeflow_app;

-- Down Migration
DROP TABLE contact_preferences;
