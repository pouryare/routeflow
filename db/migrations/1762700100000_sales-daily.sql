-- Up Migration
-- rf: expand-only
-- Saved daily sales totals for the dashboard (owner decision 2026-11-09: own totals with changed-day
-- marks; pg_ivm rejected). The dashboard used to add up every delivered order since the company
-- started on each visit; now it reads one row per (day, group, salesperson, customer) and recounts
-- only the days that changed.
--
-- How a total stays right when the past is edited: any insert, update or delete of an order or an
-- order line writes a mark for the order's day (both days, if its date moved). A payment changes
-- orders.paid_toman, so it marks the order's day too. The next dashboard read recounts the marked
-- days from the orders themselves before it reads (lib/repo/salesDaily.ts). Example: an order of
-- 3 Mehr gets one more line on 10 Aban; 3 Mehr is marked; the next read recounts 3 Mehr only.
--
-- A mark is one row per (company, day, writing transaction), so two writers never wait on each
-- other's mark. The triggers are ENABLE ALWAYS so a bulk load in replica mode (PRAGMA foreign_keys =
-- OFF in fixtures and imports) still marks. Nothing in the app truncates orders; one that did would
-- have to mark the days itself, since a TRUNCATE fires no row trigger.
-- squawk-ignore-file require-concurrent-index-creation, ban-drop-table, ban-drop-function, prefer-robust-stmts

SET lock_timeout = '5s';
SET statement_timeout = '600s';

CREATE TABLE sales_daily (
  organization_id bigint NOT NULL,
  day text NOT NULL,
  group_id bigint,
  salesperson_user_id bigint,
  customer_id bigint NOT NULL,
  orders bigint NOT NULL,
  revenue bigint,
  cost bigint,
  kg double precision,
  realized bigint NOT NULL
);
CREATE INDEX ix_sales_daily_org_day ON sales_daily (organization_id, day);

CREATE TABLE sales_daily_products (
  organization_id bigint NOT NULL,
  day text NOT NULL,
  group_id bigint,
  salesperson_user_id bigint,
  product_id bigint NOT NULL,
  revenue bigint,
  kg double precision
);
CREATE INDEX ix_sales_daily_products_org_day ON sales_daily_products (organization_id, day);

CREATE TABLE sales_daily_marks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL,
  day text NOT NULL,
  tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
  UNIQUE (organization_id, day, tx)
);

ALTER TABLE sales_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON sales_daily USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
ALTER TABLE sales_daily_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON sales_daily_products USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
ALTER TABLE sales_daily_marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON sales_daily_marks USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, DELETE ON sales_daily, sales_daily_products, sales_daily_marks TO routeflow_app;

CREATE FUNCTION rf_mark_sales_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP <> 'INSERT' AND OLD.organization_id IS NOT NULL THEN
      INSERT INTO sales_daily_marks (organization_id, day) VALUES (OLD.organization_id, left(OLD.order_date, 10))
        ON CONFLICT DO NOTHING;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.organization_id IS NOT NULL THEN
      INSERT INTO sales_daily_marks (organization_id, day) VALUES (NEW.organization_id, left(NEW.order_date, 10))
        ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    INSERT INTO sales_daily_marks (organization_id, day)
      SELECT o.organization_id, left(o.order_date, 10) FROM orders o
       WHERE o.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.order_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.order_id END)
         AND o.organization_id IS NOT NULL
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER orders_sales_day AFTER INSERT OR DELETE OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION rf_mark_sales_day();
CREATE TRIGGER order_lines_sales_day AFTER INSERT OR DELETE OR UPDATE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION rf_mark_sales_day();
ALTER TABLE orders ENABLE ALWAYS TRIGGER orders_sales_day;
ALTER TABLE order_lines ENABLE ALWAYS TRIGGER order_lines_sales_day;

-- Every day that has orders starts marked: the first dashboard read builds the totals.
INSERT INTO sales_daily_marks (organization_id, day)
  SELECT DISTINCT organization_id, left(order_date, 10) FROM orders WHERE organization_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- Down Migration
DROP TRIGGER IF EXISTS order_lines_sales_day ON order_lines;
DROP TRIGGER IF EXISTS orders_sales_day ON orders;
DROP FUNCTION IF EXISTS rf_mark_sales_day();
DROP TABLE IF EXISTS sales_daily_marks, sales_daily_products, sales_daily;
