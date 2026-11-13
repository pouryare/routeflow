-- Up Migration
-- rf: expand-only
-- F130 / T9: an optional cap on how many times one rule may fire per day for a company (null = no cap).
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE rules ADD COLUMN daily_budget bigint CHECK (daily_budget IS NULL OR daily_budget BETWEEN 1 AND 100000);

-- Down Migration
ALTER TABLE rules DROP COLUMN daily_budget;
