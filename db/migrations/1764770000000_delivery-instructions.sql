-- Up Migration
-- rf: expand-only
-- F69: standing instructions for the driver at one customer (gate code, parking, «دو بار زنگ بزنید», who receives).
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE customers ADD COLUMN delivery_instructions text CHECK (delivery_instructions IS NULL OR char_length(delivery_instructions) <= 200);

-- Down Migration
ALTER TABLE customers DROP COLUMN delivery_instructions;
