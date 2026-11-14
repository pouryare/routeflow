-- Up Migration
-- rf: expand-only
-- S9: a rule skips records that came from an Excel import unless its switch says otherwise (0 = skip imported, 1 = include).
-- squawk-ignore-file ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE rules ADD COLUMN include_imported bigint NOT NULL DEFAULT 0 CHECK (include_imported IN (0, 1));

-- Down Migration
ALTER TABLE rules DROP COLUMN include_imported;
