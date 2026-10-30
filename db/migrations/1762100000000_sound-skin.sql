-- Up Migration
-- F117: the company owner picks how the app's sounds sound for everyone in the company (lib/soundRecipes.ts
-- SKINS). A constant default: nothing is rewritten. Each person's on/off switch is in users.prefs_json.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN sound_skin text NOT NULL DEFAULT 'bubble'
  CONSTRAINT ck_organizations_sound_skin CHECK (sound_skin IN ('bubble', 'mech', 'press'));

-- Down Migration
ALTER TABLE organizations DROP COLUMN sound_skin;
