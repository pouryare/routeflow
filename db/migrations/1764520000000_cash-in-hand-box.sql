-- Up Migration
-- rf: contract
-- D1 finish: cash a field person collects is booked to a «پول در دست کارکنان» account (1104), not the office cash
-- account (1101); the day-end count moves it to 1101 and books any gap to «کسری و اضافهٔ صندوق» (5111).
-- Widens journals.source_type (a check the previous release's insert code does not know about), so it is a contract
-- migration: a failed upgrade stops and asks a person.
-- squawk-ignore-file adding-foreign-key-constraint, ban-drop-column, ban-drop-constraint, ban-drop-table, constraint-missing-not-valid, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE journals DROP CONSTRAINT journals_source_type_check;
ALTER TABLE journals ADD CONSTRAINT journals_source_type_check CHECK (source_type IN
  ('PAYMENT','CHEQUE','SALE','PURCHASE','SUPPLIER_PAYMENT','EXPENSE','OPENING','MANUAL','REVERSAL',
   'COMMISSION','COMMISSION_PAYMENT','PARTNER_ADVANCE','DIVIDEND_PAYMENT','PROFIT_SPLIT','HANDOVER'));

-- 1 when the receipt went into a person's box (cash taken by a rep, driver or phone-sales person). Older receipts stay 0.
ALTER TABLE payments ADD COLUMN in_hand bigint NOT NULL DEFAULT 0 CHECK (in_hand IN (0, 1));
ALTER TABLE cash_handovers ADD COLUMN journal_id bigint REFERENCES journals(id);

INSERT INTO accounts (code, name_fa, name_en, type, parent_id, is_postable, normal_balance, is_system, active) VALUES
  ('1104', 'پول در دست کارکنان', 'Cash held by staff', 'ASSET', NULL, 1, 'DEBIT', 1, 1),
  ('5111', 'کسری و اضافهٔ صندوق', 'Cash shortages and overages', 'EXPENSE', NULL, 1, 'DEBIT', 1, 1)
ON CONFLICT (code) DO NOTHING;

-- Down Migration
DELETE FROM accounts WHERE code IN ('1104', '5111');
ALTER TABLE cash_handovers DROP COLUMN journal_id;
ALTER TABLE payments DROP COLUMN in_hand;
ALTER TABLE journals DROP CONSTRAINT journals_source_type_check;
