-- Up Migration
-- rf: expand-only
-- D16: what a supplier sells a product for, the smallest order they take, how long they take to deliver and their own code for it.
-- squawk-ignore-file ban-drop-table, prefer-bigint-over-int, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE supplier_prices (
  organization_id bigint NOT NULL REFERENCES organizations(id),
  supplier_id bigint NOT NULL REFERENCES suppliers(id),
  product_id bigint NOT NULL REFERENCES products(id),
  price_toman bigint NOT NULL CHECK (price_toman > 0),
  min_qty double precision CHECK (min_qty IS NULL OR min_qty > 0),
  delivery_days integer CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 365),
  supplier_code text CHECK (length(supplier_code) <= 60),
  updated_at text NOT NULL,
  PRIMARY KEY (supplier_id, product_id)
);
CREATE INDEX ix_supplier_prices_org ON supplier_prices (organization_id, product_id);

ALTER TABLE supplier_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY rf_company ON supplier_prices USING (rf_scope_allows(organization_id)) WITH CHECK (rf_scope_allows(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_prices TO routeflow_app;

-- Down Migration
DROP TABLE supplier_prices;
