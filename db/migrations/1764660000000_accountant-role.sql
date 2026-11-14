-- Up Migration
-- rf: contract
-- H3: a login for the accountant. users.role may now be 'accountant'; proxy.ts confines it to the books.
-- squawk-ignore-file ban-drop-constraint, constraint-missing-not-valid, prefer-robust-stmts

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('platform_owner','owner','group_manager','rep_manager','phone_sales','field_rep','delivery_driver','shareholder','accountant','salesperson','driver'));

-- Down Migration
UPDATE users SET role = 'group_manager' WHERE role = 'accountant';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('platform_owner','owner','group_manager','rep_manager','phone_sales','field_rep','delivery_driver','shareholder','salesperson','driver'));
