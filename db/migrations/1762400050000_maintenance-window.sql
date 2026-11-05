-- Up Migration
-- rf: expand-only
-- T17 maintenance banner: the owner sets a start, an end and a short note; everyone in the company sees a
-- banner until the end, and drivers and reps are told to sync first. Nullable, nothing is rewritten.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN maintenance_from text;
ALTER TABLE organizations ADD COLUMN maintenance_to text;
ALTER TABLE organizations ADD COLUMN maintenance_note text;

-- Down Migration
ALTER TABLE organizations DROP COLUMN maintenance_note;
ALTER TABLE organizations DROP COLUMN maintenance_to;
ALTER TABLE organizations DROP COLUMN maintenance_from;
