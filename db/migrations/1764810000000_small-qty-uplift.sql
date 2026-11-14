-- Up Migration
-- rf: expand-only
-- F65 first slice: a pack can carry a rule «below N packs the unit price goes up by P percent». Off unless set. The percent that
-- applied is frozen on each order line (the price on the line already includes it), and a manager's waiver is kept on the order.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, prefer-robust-stmts, require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE packagings ADD COLUMN small_packs bigint CHECK (small_packs IS NULL OR small_packs BETWEEN 2 AND 1000);
ALTER TABLE packagings ADD COLUMN small_uplift_percent bigint CHECK (small_uplift_percent IS NULL OR small_uplift_percent BETWEEN 1 AND 100);
ALTER TABLE order_lines ADD COLUMN uplift_percent bigint NOT NULL DEFAULT 0 CHECK (uplift_percent BETWEEN 0 AND 100);
ALTER TABLE orders ADD COLUMN uplift_waive_reason text CHECK (uplift_waive_reason IS NULL OR char_length(uplift_waive_reason) <= 100);
ALTER TABLE orders ADD COLUMN uplift_waived_by bigint REFERENCES users(id);

-- Down Migration
ALTER TABLE orders DROP COLUMN uplift_waived_by;
ALTER TABLE orders DROP COLUMN uplift_waive_reason;
ALTER TABLE order_lines DROP COLUMN uplift_percent;
ALTER TABLE packagings DROP COLUMN small_uplift_percent;
ALTER TABLE packagings DROP COLUMN small_packs;
