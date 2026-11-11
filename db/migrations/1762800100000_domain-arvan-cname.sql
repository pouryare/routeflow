-- Up Migration
-- rf: expand-only
-- The CNAME value Arvan gives for an address added to its CDN by CNAME setup (docs/release-and-deploy.md, "Company addresses"):
-- the customer points their address at it, and the address check compares DNS against it.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE company_domains ADD COLUMN arvan_cname text CHECK (length(arvan_cname) <= 253);

-- Down Migration
ALTER TABLE company_domains DROP COLUMN arvan_cname;
