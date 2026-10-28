-- Up Migration
-- A login for a shareholder who is not staff: users.role may now be 'shareholder'. The account sees only its own page
-- (/my-share); proxy.ts confines it to that page and its settings, and the page reads only the row linked to it.
-- squawk-ignore-file ban-drop-constraint, constraint-missing-not-valid, prefer-robust-stmts

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('platform_owner','owner','group_manager','rep_manager','phone_sales','field_rep','delivery_driver','shareholder','salesperson','driver'));

-- Down Migration
-- Rows holding the new role would block the old constraint; move them out first.
UPDATE users SET role = 'delivery_driver' WHERE role = 'shareholder';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('platform_owner','owner','group_manager','rep_manager','phone_sales','field_rep','delivery_driver','salesperson','driver'));
