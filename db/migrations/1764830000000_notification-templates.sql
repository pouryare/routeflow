-- Up Migration
-- rf: expand-only
-- F136 first slice: a company can word its own title and body for an existing notification type, with {placeholders} filled from the event.
-- A bad override at send time falls back to the shipped text. No row = shipped text.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, ban-drop-table, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE notification_templates (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  type_code text NOT NULL,
  title_fa text NOT NULL CHECK (char_length(title_fa) BETWEEN 1 AND 80),
  body_fa text CHECK (body_fa IS NULL OR char_length(body_fa) <= 240),
  updated_by bigint NOT NULL REFERENCES users(id),
  updated_at text NOT NULL,
  PRIMARY KEY (organization_id, type_code)
);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON notification_templates USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_templates TO routeflow_app;

-- Down Migration
DROP TABLE notification_templates;
