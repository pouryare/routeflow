-- Up Migration
-- rf: expand-only
-- F121 first slice: an order line can be a pre-order, promised against goods that are on a purchase order but not received yet.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE order_lines ADD COLUMN is_preorder bigint NOT NULL DEFAULT 0 CHECK (is_preorder IN (0, 1));

-- Down Migration
ALTER TABLE order_lines DROP COLUMN is_preorder;
