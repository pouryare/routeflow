-- Up Migration
-- rf: expand-only
-- F85: how an order reached the company (phone call, visit, a message, the driver at the door, a standing order).
-- Separate from created_source (T5), which says how the record was typed in. Empty for orders made before this.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

ALTER TABLE orders ADD COLUMN channel text CHECK (channel IN ('phone', 'visit', 'message', 'driver', 'standing', 'other'));

-- Down Migration
ALTER TABLE orders DROP COLUMN channel;
