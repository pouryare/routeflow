-- Up Migration
-- rf: expand-only
-- "When did this shop last buy" (lib/repo/crm/businesses.ts LAST_ORDER, the CRM's «در خطر» chip and
-- list) is MAX(order_date) over a customer's delivered or closed sales. idx_orders_customer
-- has every order, so Postgres read each customer's orders and checked the status of every one: 120 ms
-- for the CRM counts on the heavy demo. Holding only those sales, the answer is the index's last
-- entry for the customer: 2.7 ms. Cheaper than keeping a last-order column in step with every edit.
-- Built in the migration transaction, not CONCURRENTLY: the tables are small (no real users yet)
-- and lock_timeout below stops it from waiting behind traffic.
-- squawk-ignore-file require-concurrent-index-creation, require-concurrent-index-deletion
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE INDEX ix_orders_last_sale ON orders (customer_id, order_date)
  WHERE status IN ('DELIVERED', 'CLOSED') AND COALESCE(order_type, 'SALE') = 'SALE';

-- Down Migration
DROP INDEX IF EXISTS ix_orders_last_sale;
