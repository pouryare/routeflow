-- Up Migration
-- rf: expand-only
-- D5: how a customer pays: on delivery, N days after delivery, or at the end of the month plus N days. The due date is
-- written on the order when it is delivered, so a later change of the customer's terms does not move it.
ALTER TABLE customers ADD COLUMN payment_terms_kind text NOT NULL DEFAULT 'days' CHECK (payment_terms_kind IN ('cod', 'days', 'eom'));
ALTER TABLE orders ADD COLUMN due_date text;
CREATE TRIGGER audit_customers_terms AFTER UPDATE ON customers FOR EACH ROW WHEN (OLD.payment_terms_kind IS DISTINCT FROM NEW.payment_terms_kind) EXECUTE FUNCTION rf_audit('payment_terms_kind');

-- Down Migration
DROP TRIGGER audit_customers_terms ON customers;
ALTER TABLE orders DROP COLUMN due_date;
ALTER TABLE customers DROP COLUMN payment_terms_kind;
