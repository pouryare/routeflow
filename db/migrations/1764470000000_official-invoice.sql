-- Up Migration
-- rf: contract
-- squawk-ignore-file ban-drop-column, prefer-bigint-over-int, require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '30s';
-- D7: an official (tax) invoice for some orders. The company has a tax code and a default VAT rate, a
-- product may override the rate, a customer has a tax code, and an order is marked official while it is
-- a draft. At confirmation an official order gets its number for the Jalali year and each line freezes
-- the rate it was sold at. Prices already include VAT; the invoice only splits it out.
ALTER TABLE organizations ADD COLUMN tax_id text;
ALTER TABLE organizations ADD COLUMN vat_default_pct integer NOT NULL DEFAULT 0 CHECK (vat_default_pct BETWEEN 0 AND 100);
ALTER TABLE products ADD COLUMN vat_pct integer CHECK (vat_pct BETWEEN 0 AND 100);
ALTER TABLE customers ADD COLUMN tax_id text;
ALTER TABLE orders ADD COLUMN official bigint NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN invoice_year integer;
ALTER TABLE orders ADD COLUMN invoice_no integer;
ALTER TABLE order_lines ADD COLUMN vat_pct integer;
CREATE UNIQUE INDEX ux_orders_invoice_no ON orders (organization_id, invoice_year, invoice_no) WHERE invoice_no IS NOT NULL;

-- Down Migration
DROP INDEX ux_orders_invoice_no;
ALTER TABLE order_lines DROP COLUMN vat_pct;
ALTER TABLE orders DROP COLUMN invoice_no;
ALTER TABLE orders DROP COLUMN invoice_year;
ALTER TABLE orders DROP COLUMN official;
ALTER TABLE customers DROP COLUMN tax_id;
ALTER TABLE products DROP COLUMN vat_pct;
ALTER TABLE organizations DROP COLUMN vat_default_pct;
ALTER TABLE organizations DROP COLUMN tax_id;
