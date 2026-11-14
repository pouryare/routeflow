-- Up Migration
-- rf: expand-only
-- What a driver or rep needs to say about a product at a customer's door (plan AC/VC, VC1):
-- a group to browse by, up to three selling points (one per line), one line on how to say it, and a picture
-- (content_images.id, kept in the company's storage). All optional; the cost columns are not touched.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

ALTER TABLE products ADD COLUMN category text;
ALTER TABLE products ADD COLUMN selling_points text;
ALTER TABLE products ADD COLUMN how_to_say text;
ALTER TABLE products ADD COLUMN image_id bigint;

-- Down Migration
ALTER TABLE products DROP COLUMN image_id;
ALTER TABLE products DROP COLUMN how_to_say;
ALTER TABLE products DROP COLUMN selling_points;
ALTER TABLE products DROP COLUMN category;
