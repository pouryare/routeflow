-- Up Migration
-- rf: expand-only
-- D32 «تصفیه»: a product the company is clearing out. Still sellable, left off the buy list and the
-- reorder warnings, and switched inactive by the sweep once no stock is left. Default 0, nothing rewritten.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE products ADD COLUMN sell_off bigint NOT NULL DEFAULT 0;

-- Down Migration
ALTER TABLE products DROP COLUMN sell_off;
