-- Up Migration
-- rf: expand-only
-- A12: the customer's name, phone and address are copied onto the order when it is confirmed, so a later edit of the
-- customer does not change what the order shows. Empty until the order is confirmed.
ALTER TABLE orders ADD COLUMN ship_name text;
ALTER TABLE orders ADD COLUMN ship_phone text;
ALTER TABLE orders ADD COLUMN ship_address text;

-- Down Migration
ALTER TABLE orders DROP COLUMN ship_address;
ALTER TABLE orders DROP COLUMN ship_phone;
ALTER TABLE orders DROP COLUMN ship_name;
