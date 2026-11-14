-- Up Migration
-- rf: contract
-- T4 + E7: a bulk edit of many customers also runs as a job on the worker. export_jobs is new and small.
-- squawk-ignore-file ban-drop-constraint, constraint-missing-not-valid, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_kind_check;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_kind_check CHECK (kind IN ('orders', 'bulk_edit'));

-- Down Migration
ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_kind_check;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_kind_check CHECK (kind IN ('orders'));
