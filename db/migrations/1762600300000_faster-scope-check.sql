-- Up Migration
-- rf: expand-only
-- Every row-level security policy calls rf_scope_allows(organization_id), and Postgres runs it once
-- for every row a query reads (it puts the function's body into the query). The old body ran LIKE,
-- substr and a CASE on each row. That made wide reads 2 to 5 times slower than the same query as
-- the table owner. This body answers the same thing with less work per row. Measured on 1.4
-- million demo rows (notes/db-index-audit-2026-11-09.md):
-- orders count 14 → 10 ms, payment allocations 95 → 24 ms, owner dashboard 151 → 120 ms.
--
-- The scope is one of 'org:<id>', 'all', 'system' or '' (lib/database/scope.ts). Only 'org:<id>' has
-- a colon, so split_part(scope, ':', 2) is the company id for it and '' for the others. NULLIF turns
-- that '' into NULL, and NULL matches no row. A scope that is missing reads as NULL, which also
-- matches nothing.
--
-- It stays a single SQL expression with no sub-select, so Postgres still puts it inline. A
-- sub-select or plpgsql would make it a function call on each row instead, about 10 times slower
-- (tried).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION rf_scope_allows(org bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('rf.scope', true) IN ('system', 'all')
      OR org = CAST(NULLIF(split_part(current_setting('rf.scope', true), ':', 2), '') AS bigint)
$$;

-- Down Migration
CREATE OR REPLACE FUNCTION rf_scope_allows(org bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('rf.scope', true) IN ('system', 'all') THEN true
    WHEN current_setting('rf.scope', true) LIKE 'org:%'
      THEN org = CAST(substr(current_setting('rf.scope', true), 5) AS bigint)
    ELSE false
  END
$$;
