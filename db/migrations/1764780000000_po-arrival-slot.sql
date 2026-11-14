-- Up Migration
-- rf: expand-only
-- F87: an open purchase order may say which half of its expected day the truck comes, so the warehouse can plan unloading.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE purchase_orders ADD COLUMN expected_slot text CHECK (expected_slot IS NULL OR expected_slot IN ('morning', 'afternoon'));

-- Down Migration
ALTER TABLE purchase_orders DROP COLUMN expected_slot;
