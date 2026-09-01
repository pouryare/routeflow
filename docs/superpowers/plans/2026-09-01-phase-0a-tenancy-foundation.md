# RouteFlow Phase 0a — Tenancy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RouteFlow multi-tenant — one database holding several independent companies, where no query, no role and no UNIQUE constraint can let one tenant see or collide with another.

**Architecture:** An `organizations` table sits above the existing `groups`. Every business table gains `organization_id`, backfilled to org 1 (the existing company). Tenancy is enforced at the *same choke point* group scoping already uses — `lib/session.ts` — by redefining what `owner` means: today `owner` returns `"all"` from `scopeGroupIds`, and after this it returns their own organisation's groups. A new `platform_owner` role holds the old meaning, and every cross-org read it performs is logged. Tables an owner currently reads unscoped (products, prices, purchases, commission rates) gain an explicit `orgFilter`.

**Tech Stack:** Next.js 16 App Router, TypeScript, `node:sqlite` (`DatabaseSync`), vitest (node environment, `tests/**/*.test.ts` only — no DOM harness).

**Spec:** `docs/crm-erp-plan.md` (Part 3 M1, Part 0 decisions 1, 2, 12)

## Global Constraints

- **Branch:** `phase-0-tenancy`. Never commit to `main` during this plan. Production serves the prebuilt `.next` from this same working directory, so source edits are inert until someone runs `npm run build && systemctl restart coverage-map` — do not run either.
- **Never point anything at `data/coverage.db`.** Migrations run on every `getDb()`. Tests set `process.env.COVERAGE_DB_PATH` to a temp file before importing anything from `lib/db`. A pre-migration backup already exists at `data/backups/pre-tenancy-20260901-224428.db` (141 customers, 45 orders, 6 users).
- **Dates are stored ISO/Gregorian, displayed Jalali.** No new code stores a Jalali string. See `lib/jalali.ts`.
- **Money is whole Toman in `INTEGER` columns.** See `lib/money.ts`. Do not add `REAL` money columns.
- **Migrations are idempotent and guarded on `PRAGMA table_info`,** matching the existing style in `lib/db.ts`. They run against live production data on the next deploy, so every one must be safe to run twice.
- **A row belonging to another tenant answers 404, not 403.** Same rule the codebase already applies to groups — a 403 confirms the row exists.
- **Persian UI strings.** Error text visible to a user is Persian; comments and identifiers are English.
- Run `npx tsc --noEmit && npx eslint && npm test` before every commit.

---

### Task 1: The `organizations` table and the `platform_owner` role

**Files:**
- Modify: `lib/roles.ts`
- Modify: `lib/db.ts` (migration block, near the existing `groups` migration ~line 790)
- Test: `tests/tenancy-schema.test.ts` (create)

**Interfaces:**
- Consumes: nothing — this is the first task.
- Produces: `Role` union gains `"platform_owner"`; `ROLES`, `ROLE_LABEL`, `ROLE_DESCRIPTION` gain entries. `OrganizationRow` interface exported from `lib/db.ts` as `{ id: number; name: string; slug: string; plan: string; active: number; created_at: string }`. `users.organization_id` column exists and is non-null for every row.

- [ ] **Step 1: Write the failing test**

Create `tests/tenancy-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-tenancy-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

// Imported after the env vars above are set -- lib/db reads COVERAGE_DB_PATH at module load.
const { getDb } = await import("@/lib/db");

describe("organizations table", () => {
  let db: ReturnType<typeof getDb>;
  beforeAll(() => {
    db = getDb();
  });

  it("exists with the expected columns", () => {
    const cols = (db.prepare("PRAGMA table_info(organizations)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const c of ["id", "name", "slug", "plan", "active", "created_at"]) {
      expect(cols).toContain(c);
    }
  });

  it("seeds exactly one organisation for the existing company", () => {
    const rows = db.prepare("SELECT id, slug FROM organizations").all() as { id: number; slug: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it("gives users an organization_id, and backfills every row to org 1", () => {
    const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("organization_id");

    db.exec(`INSERT INTO users (username, password_hash, display_name, role, created_at)
             VALUES ('t1', 'x:y', 'T One', 'owner', '2026-01-01')`);
    const orphan = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id IS NULL")
      .get() as { n: number };
    expect(orphan.n).toBe(0);
  });

  it("accepts platform_owner as a role", () => {
    expect(() =>
      db.exec(`INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
               VALUES ('t2', 'x:y', 'T Two', 'platform_owner', 1, '2026-01-01')`)
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tenancy-schema.test.ts`
Expected: FAIL — `PRAGMA table_info(organizations)` returns `[]`, so the first assertion fails on an empty column list.

- [ ] **Step 3: Widen the role union**

In `lib/roles.ts`, replace the union, the ordered list, and both record literals:

```ts
export type Role =
  | "platform_owner"
  | "owner"
  | "group_manager"
  | "salesperson"
  | "driver";

/** Ordered widest access first, which is also the order they read best in a dropdown. */
export const ROLES: Role[] = ["platform_owner", "owner", "group_manager", "salesperson", "driver"];

export const ROLE_LABEL: Record<Role, string> = {
  platform_owner: "مدیر سامانه",
  owner: "مالک",
  group_manager: "مدیر گروه",
  salesperson: "فروشنده",
  driver: "راننده",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  platform_owner: "دسترسی به همه سازمان‌ها — فقط برای پشتیبانی سامانه",
  owner: "دسترسی کامل به همه گروه‌ها، حساب‌ها و گزارش‌های سازمان خودش",
  group_manager: "همه مشتریان، مناطق و سفارش‌های گروه خودش",
  salesperson: "فقط سفارش‌هایی که خودش ثبت کرده و پورسانت خودش",
  driver: "فقط مسیر و تحویل‌های امروز خودش",
};
```

`scripts/create-user.mjs` keeps its own copy of the role list (it is plain ESM with no build step) and a test asserts the two agree — add `"platform_owner"` to the `ROLES` array there too, as the first element.

- [ ] **Step 4: Add the migration**

In `lib/db.ts`, immediately **before** the existing `groups` table creation, add:

```ts
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL DEFAULT 'standard',
      active INTEGER NOT NULL DEFAULT 1,
      contact_name TEXT,
      contact_phone TEXT,
      created_at TEXT NOT NULL
    );
```

Then, after the schema block, in the migration section:

```ts
  // The tenant every existing row belongs to. Seeded rather than left to a UI, because
  // every backfill below needs an id to point at, and there is exactly one company in
  // this database at the moment the column appears.
  const orgCount = db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as { n: number };
  if (orgCount.n === 0) {
    db.prepare(
      `INSERT INTO organizations (id, name, slug, plan, active, created_at)
       VALUES (1, ?, ?, 'standard', 1, ?)`
    ).run("طعمینو", "tameeno", new Date().toISOString());
  }

  // users first: every other table's backfill and every scoping decision reads the
  // organisation off the session, which is read off the user.
  const userOrgCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userOrgCols.some((c) => c.name === "organization_id")) {
    db.exec("ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id)");
    db.exec("UPDATE users SET organization_id = 1 WHERE organization_id IS NULL");
  }
```

Add the row type beside the other exported row interfaces in `lib/db.ts`:

```ts
export interface OrganizationRow {
  id: number;
  name: string;
  slug: string;
  plan: string;
  active: number;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
}
```

The `users` table has a `CHECK (role IN (...))` constraint. SQLite cannot ALTER a CHECK, so widening it to admit `platform_owner` needs the rebuild dance the file already performs twice (search for `users_role_new`). Add, guarded on the constraint text so it runs exactly once:

```ts
  // Widen users.role to admit platform_owner. Guarded on the constraint text rather than
  // on a column, because the column already exists -- it is the CHECK that has to change.
  const usersSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { sql: string } | undefined;
  if (usersSchema && !usersSchema.sql.includes("platform_owner")) {
    db.exec(`
      CREATE TABLE users_pt_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'group_manager'
          CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'salesperson', 'driver')),
        group_id INTEGER REFERENCES groups(id),
        organization_id INTEGER REFERENCES organizations(id),
        staff_code TEXT,
        phone TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        token_version INTEGER NOT NULL DEFAULT 0,
        location_consent_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO users_pt_new
        SELECT id, username, password_hash, display_name, role, group_id, organization_id,
               staff_code, phone, active, token_version, location_consent_at, created_at
          FROM users;
      DROP TABLE users;
      ALTER TABLE users_pt_new RENAME TO users;
    `);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/tenancy-schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full verification**

Run: `npx tsc --noEmit && npx eslint && npm test`
Expected: tsc exit 0; eslint 0 errors; all tests pass. The role-list agreement test between `lib/roles.ts` and `scripts/create-user.mjs` must be green — if it fails, the script's array was not updated.

- [ ] **Step 7: Commit**

```bash
git add lib/roles.ts lib/db.ts scripts/create-user.mjs tests/tenancy-schema.test.ts
git commit -m "Add organizations, and a platform_owner who can see across them"
```

---

### Task 2: `organization_id` on every business table

**Files:**
- Modify: `lib/db.ts` (migration section)
- Test: `tests/tenancy-schema.test.ts` (extend)

**Interfaces:**
- Consumes: `organizations` table and `users.organization_id` from Task 1.
- Produces: every table in `TENANT_TABLES` carries a non-null `organization_id`. Exported from `lib/db.ts` as `export const TENANT_TABLES: readonly string[]` so tests and later tasks enumerate the same list.

- [ ] **Step 1: Write the failing test**

Append to `tests/tenancy-schema.test.ts`:

```ts
import { TENANT_TABLES } from "@/lib/db";

describe("organization_id backfill", () => {
  const db = getDb();

  it("covers every business table", () => {
    for (const table of TENANT_TABLES) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name
      );
      expect(cols, `${table} is missing organization_id`).toContain("organization_id");
    }
  });

  it("leaves no row without an organisation", () => {
    for (const table of TENANT_TABLES) {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id IS NULL`)
        .get() as { n: number };
      expect(row.n, `${table} has ${row.n} rows with no organization_id`).toBe(0);
    }
  });

  it("names every table that actually holds business rows", () => {
    // A table added later without a tenant column is the exact failure this catches:
    // it would be readable by every organisation.
    const all = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    // Tables that legitimately carry no tenant: the tenant list itself, rows that reach a
    // tenant through their parent, and infrastructure that is not business data.
    const exempt = new Set([
      "organizations",
      "users",              // carries organization_id, but is not scoped *by* the helpers
      "order_lines",        // reaches a tenant through orders
      "purchase_lines",     // through purchases
      "delivery_stops",     // through delivery_runs
      "lead_list_items",    // through lead_lists
      "packagings",         // through products
      "product_prices",     // through products
      "photos",             // through (entity_type, entity_id)
      "reminders",          // through (entity_type, entity_id)
      "visit_plans",        // through (entity_type, entity_id)
      "activity_log",       // through (entity_type, entity_id)
      "push_subscriptions", // a browser endpoint, not business data
      "import_log",
      "import_snapshots",
      "sales",              // the legacy imported ledger, read-only and being retired
    ]);

    const unaccounted = all.filter((t) => !exempt.has(t) && !TENANT_TABLES.includes(t));
    expect(unaccounted, "these tables are neither tenant-scoped nor exempt").toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tenancy-schema.test.ts`
Expected: FAIL — `TENANT_TABLES` is not exported from `@/lib/db`.

- [ ] **Step 3: Add the list and the migration**

In `lib/db.ts`, near the top beside the other exports:

```ts
/** Tables whose rows belong to exactly one tenant and are scoped by organization_id.
 *
 *  A table not on this list and not in the exemption set in tests/tenancy-schema.test.ts
 *  fails the build. That is deliberate: the failure mode this list prevents is a table
 *  added later with no tenant column, which is readable by every organisation and looks
 *  like nothing at all until two customers are on the system.
 *
 *  Child tables are absent on purpose -- order_lines reaches its tenant through orders,
 *  and a second copy of the answer is a second thing to keep in step. */
export const TENANT_TABLES = [
  "groups",
  "customers",
  "districts",
  "facilities",
  "saved_locations",
  "lead_lists",
  "products",
  "orders",
  "purchases",
  "delivery_runs",
  "commission_rates",
  "commission_payments",
  "driver_commission_rates",
  "driver_commission_payments",
  "manager_commission_overrides",
  "manager_commission_payments",
] as const satisfies readonly string[];
```

Then in the migration section, after the `users.organization_id` block from Task 1:

```ts
  // Every business table gets its tenant, backfilled to the one organisation that exists.
  // Column-by-column and guarded, so this is safe to run against a database that has
  // already had some of it applied -- which is what a partial deploy leaves behind.
  for (const table of TENANT_TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "organization_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN organization_id INTEGER REFERENCES organizations(id)`);
    }
    // Runs every boot, not only on the ALTER. A row inserted by code that predates the
    // column -- an older build still running during a rolling deploy -- would otherwise
    // sit there with a null tenant and be invisible to every scoped query.
    db.exec(`UPDATE ${table} SET organization_id = 1 WHERE organization_id IS NULL`);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/tenancy-schema.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify against a copy of real data**

Migrations run against production on the next deploy, so prove they work on the real rows
before trusting them. The test harness drives the migration; the check confirms nothing was
lost:

```bash
cp data/backups/pre-tenancy-20260901-224428.db /tmp/real-check.db
COVERAGE_DB_PATH=/tmp/real-check.db npx vitest run tests/tenancy-schema.test.ts
python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/real-check.db')
for t in ['customers', 'orders', 'order_lines', 'users', 'districts', 'products']:
    print(f'{t:14}', c.execute(f'select count(*) from {t}').fetchone()[0])
print('null orgs in customers:', c.execute('select count(*) from customers where organization_id is null').fetchone()[0])
"
```

Expected: PASS, then `customers 141`, `orders 45`, `order_lines 70`, `users 6`,
`districts 439`, `products 6`, and `null orgs in customers: 0`.

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit && npx eslint && npm test
git add lib/db.ts tests/tenancy-schema.test.ts
git commit -m "Give every business table a tenant, backfilled to the one that exists"
```

---

### Task 3: Make the UNIQUE constraints per-tenant

**Files:**
- Modify: `lib/db.ts` (migration section, after Task 2's loop)
- Test: `tests/tenancy-uniqueness.test.ts` (create)

**Interfaces:**
- Consumes: `TENANT_TABLES` and the backfilled columns from Task 2.
- Produces: no new symbols. Six tables can hold the same natural key in two organisations.

**Why this task exists.** Eight constraints are globally unique today and silently break the moment a second tenant arrives: two companies cannot both have a customer coded `C001`, a product with SKU `KR250`, a district named «منطقه ۱», or the same Google Maps link saved as a lead. `users.username` deliberately stays global — there is one login form with no organisation selector, so a username has to identify a person across the whole system.

- [ ] **Step 1: Write the failing test**

Create `tests/tenancy-uniqueness.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-uniq-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe("natural keys are unique per tenant, not globally", () => {
  let db: ReturnType<typeof getDb>;
  beforeAll(() => {
    db = getDb();
    db.exec(`INSERT INTO organizations (id, name, slug, created_at)
             VALUES (2, 'Org Two', 'org-two', '2026-01-01')`);
  });

  it("lets two organisations use the same customer code", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO customers (customer_code, business_name, synced_at, organization_id)
           VALUES ('C001', 'x', '2026-01-01', ?)`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow(); // still unique *within* an organisation
  });

  it("lets two organisations use the same product SKU", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO products (name, sku, created_at, updated_at, organization_id)
           VALUES ('کره', 'KR250', '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow();
  });

  it("lets two organisations use the same group name and slug", () => {
    const ins = (org: number) =>
      db
        .prepare(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('فروش', 'sales', '2026-01-01', ?)`)
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow();
  });

  it("lets two organisations use the same order number", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO orders (order_no, customer_id, order_date, created_by, created_at, updated_at, organization_id)
           VALUES ('1001', 1, '2026-01-01', 1, '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow();
  });

  it("lets two organisations name the same district", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO districts (name, level, parent_name, boundary_geojson, updated_at, organization_id)
           VALUES ('منطقه ۱', 'mantaghe', NULL, '{}', '2026-01-01', ?)`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow();
  });

  it("lets two organisations save the same maps link and the same facility slug", () => {
    const loc = (org: number) =>
      db
        .prepare(
          `INSERT INTO saved_locations (name, maps_url, created_at, organization_id)
           VALUES ('جا', 'https://maps.example/x', '2026-01-01', ?)`
        )
        .run(org);
    loc(1);
    expect(() => loc(2)).not.toThrow();
    expect(() => loc(1)).toThrow();

    const fac = (org: number) =>
      db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, created_at, updated_at, organization_id)
           VALUES ('anbar', 'warehouse', 'انبار', 35.7, 51.4, '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    fac(1);
    expect(() => fac(2)).not.toThrow();
    expect(() => fac(1)).toThrow();
  });

  it("keeps usernames globally unique -- one login form, no organisation picker", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('same', 'x:y', 'n', 'owner', ?, '2026-01-01')`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tenancy-uniqueness.test.ts`
Expected: FAIL — the first `ins(2)` throws `UNIQUE constraint failed: customers.customer_code`.

- [ ] **Step 3: Rebuild the six tables**

SQLite cannot alter a constraint, so each is the standard rebuild the file already performs for `users`, `visit_plans` and `saved_locations`. Add to `lib/db.ts` after Task 2's loop. Each block is guarded on the constraint text so it runs exactly once.

Because the shape is identical six times, write it as one helper placed just above the migration section:

```ts
/** Rebuild a table so a globally-UNIQUE natural key becomes unique per tenant.
 *
 *  SQLite cannot ALTER a constraint, so the only route is: build the replacement, copy
 *  every row, drop, rename. Guarded on the *constraint text* rather than on a column,
 *  because the columns are unchanged -- it is the uniqueness that moves.
 *
 *  Foreign keys are suspended for the copy. With them on, DROP TABLE customers would
 *  either fail or cascade into orders depending on the pragma, and neither is what a
 *  rename wants; the schema is unchanged from the referents' point of view either way.
 */
function rebuildForTenantUnique(
  db: DatabaseSync,
  table: string,
  marker: string,
  createSql: string
): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  if (!schema || schema.sql.includes(marker)) return;

  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map((c) => `"${c.name}"`)
    .join(", ");

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(`
    ${createSql}
    INSERT INTO ${table}_tn_new (${cols}) SELECT ${cols} FROM ${table};
    DROP TABLE ${table};
    ALTER TABLE ${table}_tn_new RENAME TO ${table};
  `);
  db.exec("PRAGMA foreign_keys = ON;");
}
```

Then the six calls. Each `createSql` is the table's current definition with `organization_id` promoted into the UNIQUE. Copy the current definition from `lib/db.ts` verbatim and change only the constraint — for example, `customers`:

```ts
  rebuildForTenantUnique(
    db,
    "customers",
    "UNIQUE (organization_id, customer_code)",
    `CREATE TABLE customers_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT NOT NULL,
      business_name TEXT NOT NULL,
      contact_person TEXT, phone TEXT, address TEXT, city TEXT, province TEXT,
      lat REAL, lng REAL, status TEXT, salesperson TEXT,
      debt_0_7 REAL DEFAULT 0, debt_8_30 REAL DEFAULT 0, debt_30_plus REAL DEFAULT 0,
      notes TEXT, synced_at TEXT NOT NULL, last_purchase_date TEXT,
      group_id INTEGER REFERENCES groups(id),
      credit_limit_toman INTEGER,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, customer_code)
    );`
  );
```

Repeat for:

| Table | Marker / new constraint |
|---|---|
| `customers` | `UNIQUE (organization_id, customer_code)` |
| `products` | `UNIQUE (organization_id, sku)` |
| `groups` | `UNIQUE (organization_id, name)` **and** `UNIQUE (organization_id, slug)` — use the name one as the marker |
| `orders` | `UNIQUE (organization_id, order_no)` |
| `districts` | `UNIQUE (organization_id, name, level, parent_name)` |
| `saved_locations` | `UNIQUE (organization_id, maps_url)` |
| `facilities` | `UNIQUE (organization_id, slug)` |

**Column order in each `CREATE` must match the live table's `PRAGMA table_info` order** — the helper copies by explicit column name, so order does not strictly matter, but keeping it identical makes the diff readable and the next rebuild easier.

`orders.order_no` is allocated server-side by `formatOrderNo` in `lib/orderMath.ts`, which scans for the current maximum. Check whether it needs an organisation predicate — if it does, that is a one-line `WHERE organization_id = ?` and belongs in this task.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/tenancy-uniqueness.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove no rows were lost rebuilding against real data**

```bash
cp data/backups/pre-tenancy-20260901-224428.db /tmp/real-uniq.db
COVERAGE_DB_PATH=/tmp/real-uniq.db npx vitest run tests/tenancy-schema.test.ts
python3 -c "
import sqlite3; c=sqlite3.connect('/tmp/real-uniq.db')
for t in ['customers','orders','order_lines','districts','facilities','saved_locations','products','groups']:
    print(f'{t:18}', c.execute(f'select count(*) from {t}').fetchone()[0])
print('FK violations:', c.execute('pragma foreign_key_check').fetchall()[:5])
"
```

Expected: 141 customers, 45 orders, **70 order_lines** (the child table must survive its parent's rebuild), 439 districts, 2 facilities, 19 saved_locations, 6 products, 2 groups, and an empty foreign-key-check result.

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit && npx eslint && npm test
git add lib/db.ts tests/tenancy-uniqueness.test.ts
git commit -m "Make natural keys unique per tenant rather than globally"
```

---

### Task 4: Enforce the tenant at the scoping choke point

**Files:**
- Modify: `lib/session.ts`
- Modify: `app/api/login/route.ts` (put the organisation in the token)
- Modify: `lib/auth.ts` (`SessionClaims` gains `oid`)
- Test: `tests/tenancy-scoping.test.ts` (create)

**Interfaces:**
- Consumes: `organization_id` columns from Tasks 1–2.
- Produces:
  - `Session` gains `organizationId: number`.
  - `SessionClaims` gains `oid: number`.
  - `scopeGroupIds(session)` returns `"all"` **only** for `platform_owner`; an `owner` now gets their own organisation's group ids.
  - New `export function orgFilter(session: Session, column = "organization_id"): { sql: string; params: number[] }`.
  - New `export function canReachOrg(session: Session, organizationId: number | null): boolean`.

**The key idea.** Group scoping already funnels through `scopeGroupIds`. Today `owner` short-circuits to `"all"`, which under tenancy would mean "every company". Redefining `owner` to mean "my organisation's groups" makes every one of the 18 `groupFilter`, 12 `orderFilter` and 11 `scopeGroupIds` call sites tenant-safe without touching them. `orgFilter` then covers the tables that are not group-scoped at all.

- [ ] **Step 1: Write the failing test**

Create `tests/tenancy-scoping.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-scope-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { scopeGroupIds, orgFilter, canReachOrg, groupFilter } = await import("@/lib/session");
import type { Session } from "@/lib/session";

function session(role: string, organizationId: number, groupId: number | null, id = 1): Session {
  return {
    // Only the fields the scoping helpers read; the row is otherwise irrelevant here.
    user: { id, role, group_id: groupId, organization_id: organizationId } as never,
    role: role as never,
    groupId,
    organizationId,
  };
}

describe("tenant scoping", () => {
  beforeAll(() => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Two', 'two', '2026-01-01')`);
    db.exec(`INSERT INTO groups (id, name, slug, created_at, organization_id) VALUES (10, 'A1', 'a1', '2026-01-01', 1)`);
    db.exec(`INSERT INTO groups (id, name, slug, created_at, organization_id) VALUES (11, 'A2', 'a2', '2026-01-01', 1)`);
    db.exec(`INSERT INTO groups (id, name, slug, created_at, organization_id) VALUES (20, 'B1', 'b1', '2026-01-01', 2)`);
  });

  it("gives a platform_owner every group", () => {
    expect(scopeGroupIds(session("platform_owner", 1, null))).toBe("all");
  });

  it("gives an owner only their own organisation's groups", () => {
    const scope = scopeGroupIds(session("owner", 1, null));
    expect(scope).not.toBe("all");
    expect([...(scope as number[])].sort()).toEqual([10, 11]);
  });

  it("gives an owner of the second organisation only its groups", () => {
    expect(scopeGroupIds(session("owner", 2, null))).toEqual([20]);
  });

  it("gives an owner with no groups yet an empty scope, never everything", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (3, 'Three', 'three', '2026-01-01')`);
    expect(scopeGroupIds(session("owner", 3, null))).toEqual([]);
  });

  it("still narrows a group_manager to their one group", () => {
    expect(scopeGroupIds(session("group_manager", 1, 10))).toEqual([10]);
  });

  it("emits a group filter that lists every group of the owner's organisation", () => {
    const f = groupFilter(session("owner", 1, null));
    expect(f.sql).toContain("IN");
    expect(f.params.sort()).toEqual([10, 11]);
  });

  it("never emits an empty group filter for a scope that can reach nothing", () => {
    // An empty fragment widens the query to everything -- the exact failure to prevent.
    expect(groupFilter(session("owner", 3, null)).sql).toBe(" AND 1 = 0");
  });

  it("filters non-group tables by organisation", () => {
    expect(orgFilter(session("owner", 2, null))).toEqual({
      sql: " AND organization_id = ?",
      params: [2],
    });
    expect(orgFilter(session("platform_owner", 1, null))).toEqual({ sql: "", params: [] });
    expect(orgFilter(session("group_manager", 1, 10), "p.organization_id")).toEqual({
      sql: " AND p.organization_id = ?",
      params: [1],
    });
  });

  it("refuses a write into another organisation", () => {
    expect(canReachOrg(session("owner", 1, null), 1)).toBe(true);
    expect(canReachOrg(session("owner", 1, null), 2)).toBe(false);
    expect(canReachOrg(session("owner", 1, null), null)).toBe(false);
    expect(canReachOrg(session("platform_owner", 1, null), 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tenancy-scoping.test.ts`
Expected: FAIL — `orgFilter` is not exported from `@/lib/session`, and `scopeGroupIds` returns `"all"` for an owner.

- [ ] **Step 3: Rewrite the scoping helpers**

In `lib/session.ts`, extend the `Session` interface and replace `scopeGroupIds`, then add the two new helpers:

```ts
export interface Session {
  user: UserRow;
  role: Role;
  /** null for an owner or platform_owner, who are not scoped to any one group. */
  groupId: number | null;
  /** The tenant. Every business read is narrowed to this, except for a platform_owner. */
  organizationId: number;
}
```

```ts
/** "all" for a platform_owner; otherwise the groups this session may read.
 *
 *  An owner used to return "all", which was right when there was one company in the
 *  database. It is now the whole tenancy boundary: an owner gets **their organisation's**
 *  groups, so the eighteen groupFilter and twelve orderFilter call sites become
 *  tenant-safe without any of them changing.
 *
 *  An empty array means the caller can reach nothing -- an organisation with no groups
 *  yet, or a non-owner with none assigned. That is a real state, and it must read as
 *  "nothing", never as "everything".
 */
export function scopeGroupIds(session: Session): number[] | "all" {
  if (session.role === "platform_owner") return "all";

  if (session.role === "owner") {
    const rows = getDb()
      .prepare("SELECT id FROM groups WHERE organization_id = ?")
      .all(session.organizationId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  return session.groupId === null ? [] : [session.groupId];
}
```

`groupFilter` currently emits ` AND ${column} = ?` for a single id. An owner now has several, so widen it:

```ts
export function groupFilter(session: Session, column = "group_id"): { sql: string; params: number[] } {
  const scope = scopeGroupIds(session);
  if (scope === "all") return { sql: "", params: [] };
  if (scope.length === 0) return { sql: " AND 1 = 0", params: [] };
  if (scope.length === 1) return { sql: ` AND ${column} = ?`, params: [scope[0]] };
  return { sql: ` AND ${column} IN (${scope.map(() => "?").join(", ")})`, params: [...scope] };
}
```

Apply the same widening to `groupFilterWithShared` and `entityGroupFilter`, which both assume `scope[0]` is the only element. Then add:

```ts
/** A SQL fragment narrowing a table that carries its own organization_id.
 *
 *  For the tables group scoping cannot reach -- products, prices, purchases, commission
 *  rates -- which an owner reads unscoped today precisely because there was only ever one
 *  company. Same contract as groupFilter: never an empty fragment except for a
 *  platform_owner, because an empty fragment widens rather than narrows. */
export function orgFilter(
  session: Session,
  column = "organization_id"
): { sql: string; params: number[] } {
  if (session.role === "platform_owner") return { sql: "", params: [] };
  return { sql: ` AND ${column} = ?`, params: [session.organizationId] };
}

/** Whether this session may touch a row belonging to the given organisation. Use before
 *  any write that names an organization_id. */
export function canReachOrg(session: Session, organizationId: number | null): boolean {
  if (session.role === "platform_owner") return true;
  if (organizationId === null) return false;
  return organizationId === session.organizationId;
}
```

Populate the new field in both session constructors:

```ts
  return {
    user,
    role: user.role,
    groupId: user.group_id,
    organizationId: user.organization_id,
  };
```

Add `organization_id: number` to `UserRow` in `lib/db.ts`.

- [ ] **Step 4: Carry the organisation in the token**

In `lib/auth.ts`, add to `SessionClaims`:

```ts
  /** The tenant, so proxy.ts can refuse a cross-tenant URL without reaching SQLite. */
  oid: number;
```

In `app/api/login/route.ts`, add `oid: user.organization_id` to the `createSessionToken` call.

The authoritative organisation is still the one re-read from the row in `getSessionFromCookies` — the claim is a hint for middleware, never the decision, exactly as `role` and `gid` already are.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/tenancy-scoping.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint && npm test`

Expect several existing tests to fail here — they construct a `Session` literal without `organizationId`, and some assert that an owner sees everything. **Read each failure before changing it.** A test asserting "owner sees all groups" is now asserting the old, wrong behaviour and should become "owner sees their organisation's groups"; a test failing only because the literal lacks a field just needs the field.

```bash
git add lib/session.ts lib/auth.ts lib/db.ts app/api/login/route.ts tests/
git commit -m "Make owner mean 'my organisation', and platform_owner mean 'all of them'"
```

---

### Task 5: Close the owner-unscoped readers

**Files:**
- Modify: `lib/catalogue.ts`, `lib/purchases.ts`, `lib/commission.ts`, `lib/driverCommission.ts`, `lib/managerCommissionLedger.ts`, `lib/groups.ts`
- Modify: their ~30 call sites, listed below
- Test: `tests/tenancy-readers.test.ts` (create)

**Interfaces:**
- Consumes: `orgFilter` and `Session.organizationId` from Task 4.
- Produces: each reader takes an explicit organisation. Exact new signatures:
  - `readCatalogue(db, organizationId: number, opts?: { includeInactive?: boolean })`
  - `readPurchases(db, organizationId: number, limit = 100)`
  - `readRates(db, organizationId: number)`
  - `readDriverRates(db, organizationId: number)`
  - `readManagerOverrides(db, organizationId: number)`
  - `readGroups(db, organizationId: number)`

**Why.** Thirty sites read `session.role === "owner" ? readX(db) : []`. Each is now a leak: an owner of org 2 would see org 1's products, purchase costs and commission rates. A required parameter is used rather than an optional one deliberately — an optional organisation that defaults to "all" is a leak waiting for the one call site somebody forgets.

- [ ] **Step 1: Write the failing test**

Create `tests/tenancy-readers.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-readers-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readCatalogue } = await import("@/lib/catalogue");
const { readGroups } = await import("@/lib/groups");

describe("readers are scoped to one organisation", () => {
  beforeAll(() => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Two', 'two', '2026-01-01')`);
    db.exec(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('G1', 'g1', '2026-01-01', 1)`);
    db.exec(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('G2', 'g2', '2026-01-01', 2)`);
    db.exec(`INSERT INTO products (name, sku, created_at, updated_at, organization_id)
             VALUES ('کره یک', 'A1', '2026-01-01', '2026-01-01', 1)`);
    db.exec(`INSERT INTO products (name, sku, created_at, updated_at, organization_id)
             VALUES ('کره دو', 'B1', '2026-01-01', '2026-01-01', 2)`);
  });

  it("shows an organisation only its own products", () => {
    const db = getDb();
    expect(readCatalogue(db, 1).map((p) => p.sku)).toEqual(["A1"]);
    expect(readCatalogue(db, 2).map((p) => p.sku)).toEqual(["B1"]);
  });

  it("shows an organisation only its own groups", () => {
    const db = getDb();
    expect(readGroups(db, 1).map((g) => g.slug)).toEqual(["g1"]);
    expect(readGroups(db, 2).map((g) => g.slug)).toEqual(["g2"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tenancy-readers.test.ts`
Expected: FAIL — `readCatalogue(db, 1)` treats `1` as the options object, and both organisations' products come back.

- [ ] **Step 3: Add the parameter to each reader**

For example, `lib/groups.ts`:

```ts
export function readGroups(db: DatabaseSync, organizationId: number): GroupRow[] {
  return db
    .prepare("SELECT * FROM groups WHERE organization_id = ? ORDER BY name")
    .all(organizationId) as unknown as GroupRow[];
}
```

Apply the same shape to the other five. Where the reader already builds SQL with a `WHERE`, add ` AND organization_id = ?` and push the parameter; where it has none, add `WHERE organization_id = ?`.

- [ ] **Step 4: Update every call site**

The compiler finds them all — `npx tsc --noEmit` lists each one as "Expected 2 arguments, but got 1". The known set:

| File | Sites |
|---|---|
| `app/api/sales/stock/route.ts` | 1 (`readPurchases`) |
| `app/api/sales/commission/route.ts` | 3 (`readRates`, `readDriverRates`, `readManagerOverrides`) |
| `app/sales/products/page.tsx` | 1 (`readCatalogue`) |
| `app/sales/commission/page.tsx` | 3 |
| `app/sales/stock/page.tsx` | 2 |
| `app/api/admin/groups/route.ts`, `app/sales/admin/groups/page.tsx` | `readGroups` |
| others surfaced by tsc | — |

Each becomes `readX(db, session.organizationId, …)`. Keep the surrounding `session.role === "owner" ? … : []` conditionals exactly as they are — they express *who may see costs and rates*, which is a different question from *which company's*, and both are still needed.

`app/sales/orders/new/page.tsx:79` builds its own SQL with `session.role === "owner" ? "" : " AND group_id = ?"`. Replace that hand-rolled fragment with `groupFilter(session)` so it inherits the tenancy fix rather than keeping its own copy of the old rule.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/tenancy-readers.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit && npx eslint && npm test
git add lib/ app/ tests/tenancy-readers.test.ts
git commit -m "Scope the readers an owner used to see unscoped"
```

---

### Task 6: Log every cross-tenant access

**Files:**
- Modify: `lib/db.ts` (table)
- Create: `lib/platformAccess.ts`
- Modify: `lib/session.ts` (call it from `requireRole`)
- Test: `tests/platform-access-log.test.ts` (create)

**Interfaces:**
- Consumes: `Session.organizationId`, `platform_owner` role.
- Produces: `export function logPlatformAccess(db, session, path: string, organizationId: number | null): void` in `lib/platformAccess.ts`. Table `platform_access_log(id, platform_user_id, organization_id, path, occurred_at)`.

**Why.** `platform_owner` is a genuine cross-tenant superuser, because you are the vendor and you cannot support what you cannot see. Support access that leaves a trace is a different thing from support access that does not — and if a tenant ever asks what was looked at, the answer should be a query rather than a recollection.

- [ ] **Step 1: Write the failing test**

Create `tests/platform-access-log.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-pal-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { logPlatformAccess } = await import("@/lib/platformAccess");
import type { Session } from "@/lib/session";

const s = (role: string, oid: number, uid = 7): Session =>
  ({ user: { id: uid } as never, role: role as never, groupId: null, organizationId: oid });

describe("platform access log", () => {
  beforeAll(() => {
    getDb().exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Two', 'two', '2026-01-01')`);
  });

  it("records a platform_owner reading another organisation", () => {
    const db = getDb();
    logPlatformAccess(db, s("platform_owner", 1), "/api/customers", 2);
    const rows = db.prepare("SELECT * FROM platform_access_log").all() as {
      platform_user_id: number; organization_id: number; path: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform_user_id: 7, organization_id: 2, path: "/api/customers" });
  });

  it("does not record an ordinary owner reading their own organisation", () => {
    const db = getDb();
    db.exec("DELETE FROM platform_access_log");
    logPlatformAccess(db, s("owner", 1), "/api/customers", 1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM platform_access_log").get() as { n: number }).n).toBe(0);
  });

  it("does not record a platform_owner reading their own organisation", () => {
    const db = getDb();
    db.exec("DELETE FROM platform_access_log");
    logPlatformAccess(db, s("platform_owner", 1), "/api/customers", 1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM platform_access_log").get() as { n: number }).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/platform-access-log.test.ts`
Expected: FAIL — module `@/lib/platformAccess` does not exist.

- [ ] **Step 3: Add the table**

In `lib/db.ts`'s schema block:

```ts
    CREATE TABLE IF NOT EXISTS platform_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_user_id INTEGER NOT NULL REFERENCES users(id),
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      path TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
```

- [ ] **Step 4: Write the module**

Create `lib/platformAccess.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "./session";

/** Record that the vendor looked at a tenant's data.
 *
 *  Only writes when a platform_owner reads an organisation that is not their own. An
 *  owner inside their own company is not cross-tenant access and logging it would bury
 *  the rows that matter under ordinary traffic.
 *
 *  Deliberately not fatal: a failure here must not take a support session down. It is an
 *  audit trail, and a missing line is a smaller problem than an outage -- but it is a
 *  real problem, so it is not swallowed silently either.
 */
export function logPlatformAccess(
  db: DatabaseSync,
  session: Session,
  path: string,
  organizationId: number | null
): void {
  if (session.role !== "platform_owner") return;
  if (organizationId === null || organizationId === session.organizationId) return;

  try {
    db.prepare(
      `INSERT INTO platform_access_log (platform_user_id, organization_id, path, occurred_at)
       VALUES (?, ?, ?, ?)`
    ).run(session.user.id, organizationId, path, new Date().toISOString());
  } catch (err) {
    console.error("[platform-access-log] failed to record access", { path, organizationId, err });
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/platform-access-log.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit && npx eslint && npm test
git add lib/db.ts lib/platformAccess.ts tests/platform-access-log.test.ts
git commit -m "Record what the vendor looks at across tenants"
```

---

### Task 7: The cross-tenant leak suite

**Files:**
- Create: `tests/tenancy-isolation.test.ts`
- Create: `tests/helpers/twoOrgs.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `seedTwoOrgs(db)` returning `{ orgA, orgB }` with ids for each organisation's group, customer, product, order and users.

**Why this is its own task.** Tasks 1–6 each prove their own piece. This one asks the question the whole phase exists to answer: *can an owner of organisation B see anything at all belonging to organisation A?* It is the test that will still be here in a year, failing the build when someone adds a table and forgets the column.

- [ ] **Step 1: Write the seed helper**

Create `tests/helpers/twoOrgs.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

export interface OrgFixture {
  orgId: number;
  groupId: number;
  ownerId: number;
  managerId: number;
  customerId: number;
  productId: number;
  orderId: number;
}

const NOW = "2026-01-01T00:00:00.000Z";

/** Two complete, independent companies in one database.
 *
 *  Every row a tenant can own is created for both, with values chosen to *collide* --
 *  the same customer code, the same SKU, the same order number. A test that passes
 *  against this fixture has proved isolation, rather than proved that the ids happened
 *  to differ. */
export function seedTwoOrgs(db: DatabaseSync): { a: OrgFixture; b: OrgFixture } {
  const insert = (sql: string, ...params: unknown[]): number =>
    Number(db.prepare(sql).run(...(params as never[])).lastInsertRowid);

  const build = (orgId: number, tag: string): OrgFixture => {
    if (orgId !== 1) {
      db.prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
      ).run(orgId, `Org ${tag.toUpperCase()}`, `org-${tag}`, NOW);
    }

    const groupId = insert(
      "INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, ?, ?, ?)",
      `گروه ${tag}`, `g-${tag}`, NOW, orgId
    );

    const ownerId = insert(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, created_at)
       VALUES (?, 'x:y', ?, 'owner', NULL, ?, ?)`,
      `owner-${tag}`, `مالک ${tag}`, orgId, NOW
    );

    const managerId = insert(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, created_at)
       VALUES (?, 'x:y', ?, 'group_manager', ?, ?, ?)`,
      `manager-${tag}`, `مدیر ${tag}`, groupId, orgId, NOW
    );

    // Colliding natural keys on purpose -- these are identical in both organisations.
    const customerId = insert(
      `INSERT INTO customers (customer_code, business_name, synced_at, group_id, organization_id)
       VALUES ('SHARED-001', ?, ?, ?, ?)`,
      `مشتری ${tag}`, NOW, groupId, orgId
    );

    const productId = insert(
      `INSERT INTO products (name, sku, created_at, updated_at, organization_id)
       VALUES (?, 'SHARED-SKU', ?, ?, ?)`,
      `کره ${tag}`, NOW, NOW, orgId
    );

    const orderId = insert(
      `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, order_date,
                           created_by, created_at, updated_at, organization_id)
       VALUES ('1001', ?, ?, ?, '2026-01-01', ?, ?, ?, ?)`,
      customerId, groupId, managerId, managerId, NOW, NOW, orgId
    );

    return { orgId, groupId, ownerId, managerId, customerId, productId, orderId };
  };

  return { a: build(1, "a"), b: build(2, "b") };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/tenancy-isolation.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-iso-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { groupFilter, orgFilter, canReachOrg } = await import("@/lib/session");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
import type { Session } from "@/lib/session";

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];

const owner = (f: { orgId: number; ownerId: number }): Session =>
  ({ user: { id: f.ownerId } as never, role: "owner" as never, groupId: null, organizationId: f.orgId });

describe("organisation A and organisation B cannot see each other", () => {
  beforeAll(() => {
    ({ a, b } = seedTwoOrgs(getDb()));
  });

  it("shows each owner only their own customers", () => {
    const db = getDb();
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const f = groupFilter(owner(self), "c.group_id");
      const rows = db
        .prepare(`SELECT c.id FROM customers c WHERE 1 = 1 ${f.sql}`)
        .all(...f.params) as { id: number }[];
      expect(rows.map((r) => r.id)).toContain(self.customerId);
      expect(rows.map((r) => r.id)).not.toContain(other.customerId);
    }
  });

  it("shows each owner only their own rows in every tenant table", () => {
    const db = getDb();
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const f = orgFilter(owner(self));
      for (const table of TENANT_TABLES) {
        const rows = db
          .prepare(`SELECT organization_id FROM ${table} WHERE 1 = 1 ${f.sql}`)
          .all(...f.params) as { organization_id: number }[];
        const foreign = rows.filter((r) => r.organization_id === other.orgId);
        expect(foreign, `${table} leaked ${foreign.length} row(s) to org ${self.orgId}`).toEqual([]);
      }
    }
  });

  it("refuses a write naming the other organisation", () => {
    expect(canReachOrg(owner(a), b.orgId)).toBe(false);
    expect(canReachOrg(owner(b), a.orgId)).toBe(false);
  });

  it("lets both organisations hold the same natural keys", () => {
    const db = getDb();
    const codes = db
      .prepare("SELECT customer_code, COUNT(*) AS n FROM customers GROUP BY customer_code")
      .all() as { customer_code: string; n: number }[];
    expect(codes.find((c) => c.customer_code === "SHARED-001")?.n).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `npx vitest run tests/tenancy-isolation.test.ts`
Expected first: FAIL while the helper is a sketch. Once the helper is finished: PASS, 4 tests. **If the second test fails naming a table, that table's `organization_id` is missing or unbackfilled — fix the migration in Task 2, not the test.**

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npx eslint && npm test`
Expected: all green. Record the final test count in the commit message.

- [ ] **Step 5: Re-run the whole suite against real data**

```bash
cp data/backups/pre-tenancy-20260901-224428.db /tmp/real-final.db
COVERAGE_DB_PATH=/tmp/real-final.db npx vitest run tests/tenancy-schema.test.ts tests/tenancy-uniqueness.test.ts
python3 -c "
import sqlite3; c=sqlite3.connect('/tmp/real-final.db')
print('customers', c.execute('select count(*) from customers').fetchone()[0])
print('orders', c.execute('select count(*) from orders').fetchone()[0])
print('order_lines', c.execute('select count(*) from order_lines').fetchone()[0])
print('fk check', c.execute('pragma foreign_key_check').fetchall()[:3])
"
```

Expected: 141 / 45 / 70 and an empty foreign-key check.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "Prove two organisations in one database cannot see each other"
```

---

## What this plan deliberately leaves out

- **The repository layer.** `docs/crm-erp-plan.md` put it in Phase 0 at "about two days". That estimate was wrong: there are **305 `.prepare(` call sites across 70 files**, 154 of them outside `lib/`. Moving them all is its own multi-week phase. It is a prerequisite for **Postgres**, not for tenancy — tenancy is enforced at the `lib/session.ts` choke point instead, which is why this plan is a week rather than a month. The repo layer should be re-planned as its own phase before any Postgres work.
- **Customer type, lifecycle, representative profiles, credit approvals, demo-data purge.** These are Phase 0b and get their own plan. None of them change the tenancy boundary, so they are safely after it.
- **A UI for creating organisations.** Org 1 is seeded by migration; a second tenant is inserted by hand until there is a reason to build a screen. `platform_owner` accounts are made with `scripts/create-user.mjs`, the same bootstrap path the first owner already uses.
- **Deploying.** Nothing here is built or restarted. Merging and deploying is a separate, deliberate step after review, and it should be taken with a fresh backup in hand because the migration rebuilds six tables in place.
