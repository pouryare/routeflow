-- Up Migration
-- rf: expand-only
-- Rating tags (lib/ratingTags.ts): the owner's two lists of short reasons a driver taps after the stars of a
-- lead visit, as JSON {"good":[...],"low":[...]}. NULL means never edited: the built-in defaults apply.
-- squawk-ignore-file ban-drop-column
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN rating_tags_json text;

-- Down Migration
ALTER TABLE organizations DROP COLUMN rating_tags_json;
