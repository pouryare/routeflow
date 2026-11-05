-- Up Migration
-- Decorative effects (the coin, ticket edge, light on a card, ...): the company owner can switch them off for
-- everyone; 'auto' leaves them on except on weak phones (lib/fx.ts). A constant default: nothing is rewritten.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN effects text NOT NULL DEFAULT 'auto'
  CONSTRAINT ck_organizations_effects CHECK (effects IN ('auto', 'off'));

-- Down Migration
ALTER TABLE organizations DROP COLUMN effects;
