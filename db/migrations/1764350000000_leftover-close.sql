-- Up Migration
-- rf: contract
-- D3: a manager closes a small leftover balance with a reason. It is a payment of the new method LEFTOVER (not cash),
-- posted Dr 5110 / Cr receivables, under an owner limit kept on the company (default 50,000 toman).
-- This widens the payments.method check, which the previous release's insert code does not know about, so it is a
-- contract migration: a failed upgrade stops and asks a person.
-- squawk-ignore-file ban-drop-table, ban-drop-column, prefer-robust-stmts, constraint-missing-not-valid, adding-foreign-key-constraint
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH', 'POS', 'CARD_TO_CARD', 'CHEQUE', 'CREDIT_NOTE', 'OTHER', 'LEFTOVER'));

ALTER TABLE organizations ADD COLUMN leftover_limit_toman bigint NOT NULL DEFAULT 50000 CHECK (leftover_limit_toman BETWEEN 0 AND 100000000);
CREATE TRIGGER audit_organizations_leftover AFTER UPDATE ON organizations FOR EACH ROW WHEN (OLD.leftover_limit_toman IS DISTINCT FROM NEW.leftover_limit_toman) EXECUTE FUNCTION rf_audit('leftover_limit_toman');

INSERT INTO accounts (code, name_fa, name_en, type, parent_id, is_postable, normal_balance, is_system, active)
VALUES ('5110', 'بخشودگی و گردکردن', 'Write-offs and rounding', 'EXPENSE', NULL, 1, 'DEBIT', 1, 1)
ON CONFLICT (code) DO NOTHING;

-- Down Migration
DELETE FROM accounts WHERE code = '5110';
DROP TRIGGER audit_organizations_leftover ON organizations;
ALTER TABLE organizations DROP COLUMN leftover_limit_toman;
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH', 'POS', 'CARD_TO_CARD', 'CHEQUE', 'CREDIT_NOTE', 'OTHER'));
