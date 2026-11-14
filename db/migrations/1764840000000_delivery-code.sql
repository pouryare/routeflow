-- Up Migration
-- rf: expand-only
-- F120 first slice: a customer can ask for a delivery code (a 6-digit number worked out from the order, shown to the dispatcher). The driver types what the customer says; the result is kept on the delivery and never blocks it.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE customers ADD COLUMN delivery_code_required boolean NOT NULL DEFAULT false;
CREATE TRIGGER audit_customers_delivery_code AFTER UPDATE ON customers FOR EACH ROW WHEN (OLD.delivery_code_required IS DISTINCT FROM NEW.delivery_code_required) EXECUTE FUNCTION rf_audit('delivery_code_required');
ALTER TABLE deliveries ADD COLUMN code_ok boolean;

-- Down Migration
DROP TRIGGER audit_customers_delivery_code ON customers;
ALTER TABLE deliveries DROP COLUMN code_ok;
ALTER TABLE customers DROP COLUMN delivery_code_required;
