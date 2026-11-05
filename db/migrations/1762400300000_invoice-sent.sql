-- Up Migration
-- rf: expand-only
-- FB38: when the paper for an order was first handed over (printed, shared or saved as PDF) and how.
-- Nullable; nothing is rewritten. A first-viewed time waits for a customer-facing tracking page.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE orders ADD COLUMN invoice_sent_at text;
ALTER TABLE orders ADD COLUMN invoice_sent_via text;

-- Down Migration
ALTER TABLE orders DROP COLUMN invoice_sent_via;
ALTER TABLE orders DROP COLUMN invoice_sent_at;
