-- Up Migration
-- rf: expand-only
-- A13: the company's own words at the bottom of the receipt and the delivery note, and a prefix for
-- its order numbers. Nullable; null means the built-in default. Nothing is rewritten.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN receipt_footer text;
ALTER TABLE organizations ADD COLUMN delivery_note_footer text;
ALTER TABLE organizations ADD COLUMN order_prefix text;

-- Down Migration
ALTER TABLE organizations DROP COLUMN order_prefix;
ALTER TABLE organizations DROP COLUMN delivery_note_footer;
ALTER TABLE organizations DROP COLUMN receipt_footer;
