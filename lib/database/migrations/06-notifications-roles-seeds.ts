/* Migration era 06: Notification columns, the salesperson/driver role split, the multi-role table, the system seeds and the first tenant sweep.
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";
import { refreshRetiredWording } from "../../repo/retiredWording";
import {
  seedCapacityFactors,
  seedChurnModel,
  seedFacilities,
  seedKpiDefinitions,
  seedNotificationTypes,
  seedObjectionCards,
  seedReasonCodes,
  seedRules,
  seedSeasonalFactors,
} from "../seeds";

export function applyNotificationsRolesSeeds(db: DatabaseSync): void {
  // Notification system (Phase 1): 'notify' joins ('task','alert') as a rule action_kind
  // so a rule can drive fanOutNotifications. CREATE TABLE IF NOT EXISTS never re-applies a
  // CHECK to an already-created table and SQLite has no ALTER for CHECK, so this is the
  // standard rebuild. rule_runs.rule_id REFERENCES rules(id), so foreign keys are off for
  // the DROP (a no-op inside a transaction, hence toggled around the whole thing).
  const rulesSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rules'")
    .get() as { sql: string } | undefined;
  if (rulesSchema && !rulesSchema.sql.includes("'notify'")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE rules_notify_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER REFERENCES organizations(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          trigger_kind TEXT NOT NULL,
          condition_json TEXT,
          action_kind TEXT NOT NULL CHECK (action_kind IN ('task', 'alert', 'notify')),
          action_json TEXT,
          cooldown_min INTEGER NOT NULL DEFAULT 1440,
          escalate_after_min INTEGER,
          escalate_to_role TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (organization_id, code)
        );
        INSERT INTO rules_notify_new
          (id, organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
           cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
        SELECT
          id, organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
          cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at
        FROM rules;
        DROP TABLE rules;
        ALTER TABLE rules_notify_new RENAME TO rules;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    console.info("[migrate] rules.action_kind widened to include 'notify'");
  }

  // Notification system (Phase 2, loud channels): plain ADD COLUMN, guarded per column.
  // notification_types gains the loud-by-default hint columns (populated from
  // loudByDefault in seedNotificationTypes); push_subscriptions / users / notifications
  // gain the routing + flush bookkeeping.
  const ntCols = (db.prepare("PRAGMA table_info(notification_types)").all() as { name: string }[]).map((c) => c.name);
  if (!ntCols.includes("default_push")) db.exec("ALTER TABLE notification_types ADD COLUMN default_push INTEGER NOT NULL DEFAULT 0");
  if (!ntCols.includes("default_telegram")) db.exec("ALTER TABLE notification_types ADD COLUMN default_telegram INTEGER NOT NULL DEFAULT 0");

  const psCols = (db.prepare("PRAGMA table_info(push_subscriptions)").all() as { name: string }[]).map((c) => c.name);
  if (!psCols.includes("user_id")) db.exec("ALTER TABLE push_subscriptions ADD COLUMN user_id INTEGER");

  const uCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!uCols.includes("telegram_chat_id")) db.exec("ALTER TABLE users ADD COLUMN telegram_chat_id TEXT");
  if (!uCols.includes("telegram_link_nonce")) db.exec("ALTER TABLE users ADD COLUMN telegram_link_nonce TEXT");
  // A real face, when there is one. Nullable on purpose: most accounts have no photo, and
  // Avatar falls back to initials rather than inventing a face the system does not have.
  if (!uCols.includes("avatar_url")) db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  // avatar_url names the ROUTE; this names the FILE. Keeping them apart is what lets an
  // avatar_url hold a `?key=chef-2` preset while avatar_stem still points at the real
  // upload -- so clearing a preset does not lose the photograph.
  if (!uCols.includes("avatar_stem")) db.exec("ALTER TABLE users ADD COLUMN avatar_stem TEXT");

  // Widen users.role to the new vocabulary. SQLite cannot ALTER a CHECK, so this is the
  // table-rebuild pattern already used four times in this file -- build the replacement,
  // copy every row, drop, rename.
  //
  // The constraint admits BOTH vocabularies on purpose. A row saying 'driver' is not a bug
  // to be corrected here: it is a person whose primary role is rewritten one step below, and
  // the rewrite needs the constraint to already permit the new name. Narrowing the CHECK to
  // exclude the old names is a separate, later migration -- one that can only run once no
  // row carries them.
  //
  // The copy is driven by PRAGMA table_info rather than a written column list, because
  // telegram_chat_id, telegram_link_nonce, prefs_json, avatar_url and avatar_stem were all
  // added by ALTER after the previous rebuild. A hand-written list drops them, and every
  // user's Telegram link dies with no error anywhere.
  const usersSplitSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersSplitSchema && !usersSplitSchema.sql.includes("phone_sales")) {
    const usersCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[])
      .map((c) => `"${c.name}"`)
      .join(", ");

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_rolesplit_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'phone_sales', 'field_rep', 'delivery_driver', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL,
          telegram_chat_id TEXT,
          telegram_link_nonce TEXT,
          prefs_json TEXT,
          avatar_url TEXT,
          avatar_stem TEXT
        );
        INSERT INTO users_rolesplit_new (${usersCols})
          SELECT ${usersCols} FROM users;
        DROP TABLE users;
        ALTER TABLE users_rolesplit_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Now that the CHECK admits them, rewrite the primary role. 'driver' split in two and the
  // column can only name one: it becomes 'delivery_driver', the world these accounts land in
  // today. Their full set (Task 2) carries BOTH, so promoting someone to field_rep later is a
  // one-column update with no backfill.
  db.exec("UPDATE users SET role = 'phone_sales'    WHERE role = 'salesperson'");
  db.exec("UPDATE users SET role = 'delivery_driver' WHERE role = 'driver'");

  // The two TEXT columns that hold a role NAME, which the type system cannot check. A stale
  // value here is a task nobody is ever offered: rules.ts resolves an escalation with
  // `WHERE role = ?`, so a retired name matches no one and the escalation never fires.
  // 'driver' rows are classified by what the task is; role_hint OFFERS work rather than
  // granting access, so the default is field_rep -- a wrongly-offered task is a manager's
  // problem for a day, a wrongly-REMOVED one is work that silently never happens.
  if (db.prepare("SELECT 1 FROM tasks WHERE role_hint = 'salesperson' LIMIT 1").get()) {
    db.exec("UPDATE tasks SET role_hint = 'phone_sales' WHERE role_hint = 'salesperson'");
  }
  if (db.prepare("SELECT 1 FROM tasks WHERE role_hint = 'driver' LIMIT 1").get()) {
    db.exec(`
      UPDATE tasks SET role_hint = 'delivery_driver'
       WHERE role_hint = 'driver' AND kind IN ('delivery', 'deliver', 'stop');
      UPDATE tasks SET role_hint = 'field_rep' WHERE role_hint = 'driver';
    `);
  }
  if (db.prepare("SELECT 1 FROM rules WHERE escalate_to_role = 'salesperson' LIMIT 1").get()) {
    db.exec("UPDATE rules SET escalate_to_role = 'phone_sales' WHERE escalate_to_role = 'salesperson'");
  }
  if (db.prepare("SELECT 1 FROM rules WHERE escalate_to_role = 'driver' LIMIT 1").get()) {
    // An escalation names who to hand a STUCK task to, which is a judgement call rather
    // than a delivery. A manager always exists to unstick it, so this one IS mechanical.
    db.exec("UPDATE rules SET escalate_to_role = 'group_manager' WHERE escalate_to_role = 'driver'");
  }

  /* Multi-role (docs/superpowers/specs/2026-09-28-multi-role-switcher-design.md): a person's
   * roles become a SET, while users.role stays their primary. Guarded on the table being
   * absent, so this runs exactly once and a re-boot is a no-op.
   *
   *  The plan's original version of this migration ALSO copied 'driver' -> both van roles,
   *  because at the time users.role still held the retired name. It no longer does: the
   *  vocabulary migration above has already rewritten every row to phone_sales or
   *  delivery_driver. So today's delivery_driver accounts are ALREADY only delivery_driver
   *  in this table, and the question the plan asked — "does today's driver do both jobs, and
   *  must they keep both on the day this ships?" — can no longer be answered from the column.
   *
   *  The backfill is therefore deliberately honest rather than generous: it copies the
   *  primary verbatim and does NOT invent a second role. Giving a real account a second hat
   *  it was never granted is a privilege change disguised as a migration. A person who does
   *  both jobs is granted both roles explicitly, through the admin screen, by a person who
   *  knows they do both jobs. */
  const hasUserRolesTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'")
    .get();
  if (!hasUserRolesTable) {
    db.exec(`
      CREATE TABLE user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role    TEXT NOT NULL,
        PRIMARY KEY (user_id, role)
      );
    `);
  }
  // The backfill runs on EVERY boot, guarded by INSERT OR IGNORE, and must NOT be keyed on
  // the table's existence: the CREATE TABLE IF NOT EXISTS in the schema block above has
  // already made the table by the time this runs, so a table-existence guard means the
  // backfill never fires on a fresh database. Probed, not assumed — the first version of
  // this guard produced an empty user_roles and a test that said "gives a fresh account its
  // own primary role in the set" and got [].
  db.exec(`
      INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, role FROM users;
      DELETE FROM user_roles WHERE role IN ('driver', 'salesperson');
  `);

  /* A new account MUST land in user_roles, and the plan's version did not arrange that.
   *
   *  Six places insert into users (lib/users.ts, the admin API, create-user.mjs, two seed
   *  scripts, and the platform_owner bootstrap). The plan noted the scripts "do not write
   *  user_roles; that is fine, because the session falls back to the primary when the set
   *  is empty" — true for a SESSION, and false for every ENUMERATION.
   *
   *  The session fallback is a courtesy. The nineteen Task 4a queries are not: they ask
   *  "everyone who can sell / drive / be assigned a run", and they read this table. A
   *  salesperson created this morning with an empty set is invisible to all of them, so
   *  their commission statement comes out empty and nobody notices until payday. The spec
   *  names that exact failure as the reason this table exists, and a backfill that only
   *  runs once would reintroduce it on the very next signup.
   *
   *  So the primary is kept in the set by the DATABASE, not by six call sites that can
   *  each forget. That is what makes the invariant hold for the seventh, unseen one.
   *
   *  IF NOT EXISTS on both: these run on every boot, and a bare CREATE TRIGGER throws
   *  "already exists" on the second one -- taking the whole boot down. */
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS user_roles_after_insert
    AFTER INSERT ON users
    BEGIN
      INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (NEW.id, NEW.role);
    END;

    /* Changing someone's primary must move their set with it, or Task 3's session.roles
     * would read a stale set and hand them permissions their column no longer claims.
     *
     *  The set is replaced ONLY when it still holds nothing but the old primary — i.e. the
     *  person never had a second hat. A set with two or more roles was arranged on
     *  purpose by the admin screen, and a primary change must not silently delete half of
     *  it; that is the admin screen's job, and it is Task 9. */
    CREATE TRIGGER IF NOT EXISTS user_roles_after_update
    AFTER UPDATE OF role ON users
    WHEN (SELECT COUNT(*) FROM user_roles WHERE user_id = NEW.id) <= 1
      AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = NEW.id AND role = OLD.role)
    BEGIN
      UPDATE user_roles SET role = NEW.role WHERE user_id = NEW.id;
    END;
  `);

  /* Who was really driving. Nullable, no cascade: an audit row must outlive the user it
   * names, which is why `events` carries no FKs on any reference at all.
   *
   * NULL for every ordinary write, so "not an impersonation" is the DEFAULT and no caller
   * has to special-case it. The three tables are exactly the ones that already record an
   * actor — activity_log.changed_by_user_id, order_events.actor_user_id,
   * events.actor_user_id — so this is a missing column, not a missing audit system. */
  for (const t of ["activity_log", "order_events", "events"]) {
    const cols = (db.prepare("PRAGMA table_info(" + t + ")").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("impersonated_by")) {
      db.exec("ALTER TABLE " + t + " ADD COLUMN impersonated_by INTEGER REFERENCES users(id)");
    }
  }

  /* The founder is the platform owner, AND he runs طعمینو, so he holds both hats. This is
   * the one account in the app with two roles, and it is the whole reason the multi-role
   * work exists: "I am the vendor AND I am the owner of this company" is a single sentence
   * that `users.role` cannot express.
   *
   * Idempotent and keyed on the username, because the founder's id is not something a
   * migration may assume. The set is written AFTER the primary change above, so the
   * after-update trigger has already moved the row to platform_owner and this only ADDS the
   * second hat.
   *
   * The second INSERT is the load-bearing one: it is what makes `session.roles` return two
   * entries, which is what makes the picker appear for him and nothing else. */
  db.exec(`
    UPDATE users SET role = 'platform_owner' WHERE username = 'pourya';
    INSERT OR IGNORE INTO user_roles (user_id, role)
      SELECT id, 'owner' FROM users WHERE username = 'pourya';
  `);

  const nCols = (db.prepare("PRAGMA table_info(notifications)").all() as { name: string }[]).map((c) => c.name);
  if (!nCols.includes("push_flushed_at")) db.exec("ALTER TABLE notifications ADD COLUMN push_flushed_at TEXT");
  if (!nCols.includes("tg_flushed_at")) db.exec("ALTER TABLE notifications ADD COLUMN tg_flushed_at TEXT");
  /* ref_id: the row a one-tap action should act on when it is not the entity the notification is
     about (a due reminder is about a customer, but the button resolves the reminder). */
  if (!nCols.includes("ref_id")) db.exec("ALTER TABLE notifications ADD COLUMN ref_id INTEGER");

  seedFacilities();
  seedReasonCodes(db);
  seedCapacityFactors(db);
  seedRules(db);
  seedNotificationTypes(db);
  seedObjectionCards(db);
  seedKpiDefinitions(db);
  refreshRetiredWording(db);
  seedSeasonalFactors(db);
  seedChurnModel(db);
}
