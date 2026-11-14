-- Up Migration
-- rf: expand-only
-- T5: how a record was created, stored next to who created it. Customers, orders, payments and tasks each get one
-- optional word (form, quick, offline, import, rule, conversion, driver, ...). Rows made before this stay empty.
-- It is the way to tell an Excel import from a visit (so rules can leave imported records alone, S9) and the base of
-- the order channel (F85).
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '5s';

ALTER TABLE customers ADD COLUMN created_source text;
ALTER TABLE orders ADD COLUMN created_source text;
ALTER TABLE payments ADD COLUMN created_source text;
ALTER TABLE tasks ADD COLUMN created_source text;

-- Down Migration
ALTER TABLE tasks DROP COLUMN created_source;
ALTER TABLE payments DROP COLUMN created_source;
ALTER TABLE orders DROP COLUMN created_source;
ALTER TABLE customers DROP COLUMN created_source;
