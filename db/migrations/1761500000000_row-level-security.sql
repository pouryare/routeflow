-- Up Migration
-- Row-level security on every table that carries organization_id (Wave P, phase 3).
--
-- The app's own WHERE organization_id = ? stays; this is the net under it. A query that forgets
-- the company gets no other company's rows, because the database itself refuses them.
--
-- The app connects as routeflow_app (PG_APP_ROLE), which does not own the tables, so the policies
-- apply to it; migrations run as the owner, which they do not. Before each statement the adapter
-- sets rf.scope (lib/database/scope.ts):
--   'org:<id>'  that company's rows, plus the shared rows whose organization_id is NULL (read only);
--   'all'       every company's rows: a platform owner looking across them;
--   'system'    every company's rows: jobs, scripts, the sign-in lookup, test fixtures;
--   ''          nothing: a request with no session. Missing is the same as ''.
--
-- Tables without organization_id (order_lines, packagings, product_prices, ...) reach a company
-- through a parent row and are not covered here; tests/tenancy-* check those reads.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'routeflow_app') THEN
    CREATE ROLE routeflow_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO routeflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO routeflow_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO routeflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO routeflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO routeflow_app;

CREATE FUNCTION rf_scope_allows(org bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('rf.scope', true) IN ('system', 'all') THEN true
    WHEN current_setting('rf.scope', true) LIKE 'org:%'
      THEN org = CAST(substr(current_setting('rf.scope', true), 5) AS bigint)
    ELSE false
  END
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY rf_company ON %I USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id))', t);
    EXECUTE format('CREATE POLICY rf_shared ON %I FOR SELECT USING (organization_id IS NULL)', t);
  END LOOP;
END $$;

-- Down Migration
-- squawk-ignore-file ban-drop-function
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'rf_company' LOOP
    EXECUTE format('DROP POLICY rf_company ON %I', t);
    EXECUTE format('DROP POLICY rf_shared ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
DROP FUNCTION rf_scope_allows(bigint);
