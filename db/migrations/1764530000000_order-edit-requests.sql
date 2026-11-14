-- Up Migration
-- rf: contract
-- F48 + F73: a manager's edit of a confirmed order's delivery day, due date, address or notes waits for the owner like a
-- credit-limit raise does, and an unanswered request lapses after 3 days. Widens two checks,
-- which the previous release's insert code does not know about, so it is a contract migration.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, ban-drop-constraint, ban-drop-table, constraint-missing-not-valid, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE change_requests DROP CONSTRAINT change_requests_kind_check;
ALTER TABLE change_requests ADD CONSTRAINT change_requests_kind_check CHECK (kind IN ('credit_limit', 'order_edit'));
ALTER TABLE change_requests DROP CONSTRAINT change_requests_status_check;
ALTER TABLE change_requests ADD CONSTRAINT change_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));
ALTER TABLE change_requests ADD COLUMN order_id bigint REFERENCES orders(id);
ALTER TABLE change_requests ADD COLUMN field text CHECK (field IS NULL OR field IN ('requested_day', 'due_date', 'ship_address', 'notes'));
ALTER TABLE change_requests ADD COLUMN old_text text;
ALTER TABLE change_requests ADD COLUMN new_text text CHECK (new_text IS NULL OR length(new_text) <= 500);
ALTER TABLE change_requests ADD CONSTRAINT change_requests_shape_check CHECK (kind = 'credit_limit' OR (order_id IS NOT NULL AND field IS NOT NULL));

-- Down Migration
ALTER TABLE change_requests DROP CONSTRAINT change_requests_shape_check;
ALTER TABLE change_requests DROP COLUMN new_text;
ALTER TABLE change_requests DROP COLUMN old_text;
ALTER TABLE change_requests DROP COLUMN field;
ALTER TABLE change_requests DROP COLUMN order_id;
ALTER TABLE change_requests DROP CONSTRAINT change_requests_status_check;
ALTER TABLE change_requests DROP CONSTRAINT change_requests_kind_check;
