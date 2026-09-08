# RouteFlow Phase 0b — Foundations (remainder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `crm-erp-plan.md`'s "Phase 0. Foundations" — remove the Excel customer-import and delivery-parse subsystems, add a scoped `lib/repo` query layer, land the M2 data model (customer type/lifecycle/credit, representative profiles with an onboarding workflow, `credit_approvals` for direct customers), and harden the demo-data purge.

**Architecture:** `customers` becomes an app-owned table with no upstream that can silently revert it. A `lib/repo/` layer wraps `getDb().prepare` for the new M2 tables only, gated by a test that blocks new raw SQL outside it (the 71 existing files are grandfathered on an allowlist that may only shrink). New columns and tables land via the same idempotent, `PRAGMA`-guarded, table-rebuild migration style already in `lib/db.ts`. Two new tenant tables (`representative_profiles`, `credit_approvals`) join `TENANT_TABLES` and the existing two-org isolation suite covers them automatically.

**Tech Stack:** Next.js 16 App Router, TypeScript, `node:sqlite` (`DatabaseSync`), vitest (node environment, `tests/**/*.test.ts` only — no DOM harness), `exceljs` (kept, for order export only).

**Spec:** `docs/superpowers/specs/2026-09-02-phase-0b-foundations-design.md`

## Global Constraints

- **Branch `phase-0b-foundations`.** Never commit to `main`. Production serves a prebuilt `.next` from this working directory; source edits are inert until `npm run build && systemctl restart routeflow` — do not run either. The whole stack merges/deploys after Phase 10 (user decision 2026-09-02).
- **Never point anything at `data/coverage.db`.** Tests set `process.env.COVERAGE_DB_PATH` to a temp file before importing `lib/db`. Real-data checks: `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/tenancy-schema.test.ts`; take the copy via the SQLite backup API, never `cp` (live DB is WAL). Pre-migration backup exists: `data/backups/pre-tenancy-20260901-224428.db` (141 customers, 45 orders, 6 users).
- **Migrations are idempotent and guarded on `PRAGMA table_info` / constraint text,** matching `lib/db.ts`. They run against live production data on the next deploy; every one must be safe to run twice.
- **Dates are ISO/Gregorian in storage, Jalali in display** (`lib/jalali.ts`). No new code stores a Jalali string.
- **Money is whole Toman in `INTEGER` columns** (`lib/money.ts`). No `REAL` money columns.
- **A row belonging to another tenant answers 404, not 403.**
- **Persian UI strings.** User-visible error text is Persian; comments and identifiers are English.
- **Run `npx tsc --noEmit && npx eslint && npm test` before every commit.** One task per commit. TDD: failing test → verify it fails → implement → verify it passes → commit.
- **`lib/roles.ts` and `scripts/create-user.mjs` must not drift** — a test (`tests/roles-sync.test.ts` or similar) asserts it. Any role edit touches both.

---

### Task 1: Remove the Excel customer-import subsystem

**Files:**
- Delete: `lib/importExcel.ts`, `lib/oneDriveFetch.ts`
- Delete: `app/api/import/route.ts`, `app/api/import/onedrive/route.ts`, `app/api/import/status/route.ts`, `app/api/import/undo/route.ts`
- Delete: `components/ImportPanel.tsx`
- Delete: `tests/**` files that import any of the above (enumerate in Step 1)
- Modify: `components/CoverageMap.tsx` (remove the dynamic import at ~line 108 and the `<ImportPanel …/>` mount at ~line 2081, plus the stale comment at ~647)
- Modify: `lib/db.ts` (add a migration that `DROP TABLE IF EXISTS import_log; DROP TABLE IF EXISTS import_snapshots;`)
- Modify: `tests/tenancy-schema.test.ts` (remove `"import_log"` and `"import_snapshots"` from the `exempt` set, lines ~159–160)
- Modify: `.env.local` and any reader — remove `ONEDRIVE_SALES_FILE_URL`
- Test: `tests/no-excel-import.test.ts` (create — a guard that the subsystem stays gone)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. After this task `grep -rn "importExcel\|oneDriveFetch\|/api/import\b\|ONEDRIVE_SALES_FILE_URL\|importCustomersFromWorkbook" app/ lib/ components/ tests/` returns no hits.

- [ ] **Step 1: Enumerate the blast radius**

Run and record the output — these are the files Step 3 deletes or edits:

```bash
grep -rln "importExcel\|oneDriveFetch\|importCustomersFromWorkbook\|fetchOneDriveFile\|/api/import\|ONEDRIVE_SALES_FILE_URL\|ImportPanel" \
  app/ lib/ components/ tests/ scripts/ | sort
```

Expected to include: `lib/importExcel.ts`, `lib/oneDriveFetch.ts`, the four `app/api/import/*` routes, `components/ImportPanel.tsx`, `components/CoverageMap.tsx`, and any `tests/api/import*.test.ts` / `tests/*importExcel*.test.ts` / `tests/*oneDrive*.test.ts`.

- [ ] **Step 2: Write the guard test (fails until the code is gone)**

Create `tests/no-excel-import.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("the Excel customer-import subsystem stays removed", () => {
  it("has no importExcel / oneDriveFetch / /api/import references", () => {
    const hits = execSync(
      "grep -rln 'importExcel\\|oneDriveFetch\\|importCustomersFromWorkbook\\|/api/import\\|ONEDRIVE_SALES_FILE_URL' app lib components || true",
      { encoding: "utf8" }
    ).trim();
    expect(hits, `still referenced in:\n${hits}`).toBe("");
  });

  it("has no import_log / import_snapshots tables after migration", async () => {
    const { getDb } = await import("@/lib/db");
    const rows = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('import_log','import_snapshots')")
      .all();
    expect(rows).toEqual([]);
  });
});
```

> This test file sets no `COVERAGE_DB_PATH` of its own — add the standard temp-db preamble used by the other `tests/*.test.ts` (see `tests/tenancy-readers.test.ts` lines 1–16) so the second `it` runs migrations against a fresh DB.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/no-excel-import.test.ts`
Expected: FAIL — both assertions (grep finds hits; tables still exist).

- [ ] **Step 4: Delete the library and route files**

```bash
git rm lib/importExcel.ts lib/oneDriveFetch.ts \
  app/api/import/route.ts app/api/import/onedrive/route.ts \
  app/api/import/status/route.ts app/api/import/undo/route.ts \
  components/ImportPanel.tsx
git rm $(grep -rln "importExcel\|oneDriveFetch\|importCustomersFromWorkbook" tests/)
```

- [ ] **Step 5: Unmount `ImportPanel` from `CoverageMap.tsx`**

Remove the three fragments (line numbers approximate — search, don't trust them):
- `const ImportPanel = dynamic(() => import("./ImportPanel"), { ssr: false });`
- the `<ImportPanel onImported={loadCustomers} />` JSX
- the comment block that mentions "Excel import (ImportPanel's onImported …)"

If `loadCustomers` becomes unused after this, leave it — it is still used elsewhere in that file; confirm with `tsc`.

- [ ] **Step 6: Add the drop-tables migration**

In `lib/db.ts`, in the migration section (after the other Phase 0a/0b migrations, near the end of `getDb`'s migration block), add:

```ts
// Phase 0b: the Excel customer importer is gone. Its bookkeeping tables go with it.
// DROP IF EXISTS is idempotent and safe to run twice.
db.exec("DROP TABLE IF EXISTS import_log;");
db.exec("DROP TABLE IF EXISTS import_snapshots;");
```

- [ ] **Step 7: Remove the two tables from the tenancy-schema exempt list**

In `tests/tenancy-schema.test.ts`, delete the `"import_log",` and `"import_snapshots",` lines from the `exempt` set.

- [ ] **Step 8: Remove `ONEDRIVE_SALES_FILE_URL`**

`grep -rn "ONEDRIVE_SALES_FILE_URL" .` — remove from `.env.local`, `.env.example` if present, and any `process.env.ONEDRIVE_SALES_FILE_URL` reader (there should be none left after Step 4; if one remains it was a second consumer — delete that line).

- [ ] **Step 9: Run the full check**

Run: `npx tsc --noEmit && npx eslint && npx vitest run`
Expected: PASS. `tests/no-excel-import.test.ts` green; no new failures; the deleted tests are gone.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Remove the Excel customer importer and its OneDrive fetch"
```

---

### Task 2: Remove the delivery-run parser

**Files:**
- Delete: `lib/deliveryParse.ts`, `app/api/deliveries/parse/route.ts`, `components/DeliveryImportPanel.tsx`
- Delete: any `tests/*deliveryParse*` / `tests/api/deliveries-parse*` test
- Modify: `lib/deliveryTypes.ts` (it does `import type { DeliveryStop } from "./deliveryParse"` — inline the type)
- Modify: `app/planner/page.tsx` (remove the `import DeliveryImportPanel` at line 17 and the `<DeliveryImportPanel …/>` mount at ~line 680)
- Test: extend `tests/no-excel-import.test.ts` guard (or a sibling) to also assert `deliveryParse` is gone

**Interfaces:**
- Consumes: nothing.
- Produces: `lib/deliveryTypes.ts` now *defines* `DeliveryStop` rather than re-exporting it. Its shape (copy from the current `deliveryParse.ts` definition — read it before deleting):

```ts
export interface DeliveryStop {
  customerName: string;
  orderNo: string | null;
  address: string | null;
  items: { productName: string; packs: number }[];
  // ...copy every field the current lib/deliveryParse.ts DeliveryStop has
}
```

- [ ] **Step 1: Read and copy the `DeliveryStop` definition**

`sed -n '1,60p' lib/deliveryParse.ts` — copy the exact `DeliveryStop` interface (and any type it depends on) into a scratch note for Step 4.

- [ ] **Step 2: Write the guard**

Append to `tests/no-excel-import.test.ts`:

```ts
it("has no delivery-parse subsystem", () => {
  const hits = execSync(
    "grep -rln 'deliveryParse\\|DeliveryImportPanel\\|/api/deliveries/parse' app lib components || true",
    { encoding: "utf8" }
  ).trim();
  expect(hits, `still referenced in:\n${hits}`).toBe("");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/no-excel-import.test.ts`
Expected: FAIL on the new assertion.

- [ ] **Step 4: Inline `DeliveryStop` into `lib/deliveryTypes.ts`**

Replace the `import type { DeliveryStop } from "./deliveryParse"` line with the interface definition copied in Step 1. Keep the `export`.

- [ ] **Step 5: Delete the parser files**

```bash
git rm lib/deliveryParse.ts app/api/deliveries/parse/route.ts components/DeliveryImportPanel.tsx
git rm $(grep -rln "deliveryParse\|parseDeliveryWorkbook\|parseDeliveryText" tests/ || true)
```

- [ ] **Step 6: Unmount from `app/planner/page.tsx`**

Remove the `import DeliveryImportPanel from "@/components/DeliveryImportPanel";` line and the `<DeliveryImportPanel selectedDate={selectedDate} onAdded={loadWeek} />` JSX. If the surrounding wrapper element is now empty, remove it too. `loadWeek` stays (used elsewhere on the page — confirm with `tsc`).

- [ ] **Step 7: Confirm a run can still be built without the parser**

Read `app/api/sales/runs/route.ts` (POST creates a run) and `app/api/sales/runs/[id]/stops/route.ts` (POST adds a stop from an order id). Confirm the `/sales/runs` or `/planner` UI still offers "create run" + "add order to run" without the deleted panel. If it does not — if `DeliveryImportPanel` was the *only* way to populate a run — add a note to the commit body and open a follow-up; do **not** build a replacement in this task (Phase 3 owns that). Record the finding either way.

- [ ] **Step 8: Full check**

Run: `npx tsc --noEmit && npx eslint && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Remove the paste-a-spreadsheet delivery-run parser"
```

---

### Task 3: The `lib/repo` layer and its raw-SQL boundary gate

**Files:**
- Create: `lib/repo/base.ts`, `lib/repo/README.md`
- Create: `tests/fixtures/raw-sql-allowlist.txt`
- Test: `tests/repo-boundary.test.ts`

**Interfaces:**
- Produces:
  - `lib/repo/base.ts` — `export function makeRepo<Row>(table: string, opts: { tenant: boolean }): Repo<Row>` where
    ```ts
    interface Repo<Row> {
      get(organizationId: number, id: number): Row | undefined;   // tenant: WHERE id=? AND organization_id=?
      list(organizationId: number, where?: Partial<Row>): Row[];
      insert(organizationId: number, row: Omit<Row, "id">): number; // returns new id; stamps organization_id
      patch(organizationId: number, id: number, fields: Partial<Row>): void;
      db(): DatabaseSync;   // escape hatch for hand-written SQL *inside a repo module*
    }
    ```
    When `opts.tenant` is `false`, the `organizationId` parameter is still required in the signature but ignored (keeps call sites uniform); prefer `tenant: true` for every M2 table.
  - `tests/fixtures/raw-sql-allowlist.txt` — newline-separated repo-relative paths permitted to contain raw `.prepare(`/`db.exec("<sql>")`. Seeded with every current offender. May only shrink.

- [ ] **Step 1: Write the boundary test**

Create `tests/repo-boundary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";

const ALLOWLIST = "tests/fixtures/raw-sql-allowlist.txt";

function rawSqlFiles(): string[] {
  // .prepare( or db.exec(" with a string literal, anywhere under app/ or lib/
  const out = execSync(
    `grep -rlnE '\\.(prepare)\\(|\\.exec\\(\\s*\`|\\.exec\\(\\s*"' app lib || true`,
    { encoding: "utf8" }
  );
  return out.split("\n").map((s) => s.trim()).filter(Boolean).sort();
}

describe("raw SQL lives in lib/repo or on the grandfather allowlist", () => {
  it("introduces no new raw-SQL file", () => {
    const allow = new Set(
      fs.readFileSync(ALLOWLIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
    );
    const offenders = rawSqlFiles().filter(
      (f) => !f.startsWith("lib/repo/") && !allow.has(f)
    );
    expect(offenders, `new raw SQL outside lib/repo/:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the allowlist only shrinks (no path added vs git HEAD)", () => {
    const headList = execSync(`git show HEAD:${ALLOWLIST} 2>/dev/null || true`, { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    const nowList = fs.readFileSync(ALLOWLIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    const added = nowList.filter((p) => !headList.includes(p));
    expect(added, `allowlist grew:\n${added.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/repo-boundary.test.ts`
Expected: FAIL — `tests/fixtures/raw-sql-allowlist.txt` does not exist.

- [ ] **Step 3: Seed the allowlist**

```bash
mkdir -p tests/fixtures
grep -rlnE '\.(prepare)\(|\.exec\(\s*`|\.exec\(\s*"' app lib | sort > tests/fixtures/raw-sql-allowlist.txt
wc -l tests/fixtures/raw-sql-allowlist.txt   # expect ~71
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run tests/repo-boundary.test.ts`
Expected: first `it` PASS (every offender is on the list); second `it` PASS (no additions — HEAD has no such file yet, so `headList` is empty and `added` equals the whole list… **fix:** on the very first commit the second assertion would fail). Change the second `it` to skip when `git show HEAD:$ALLOWLIST` is empty:

```ts
if (headList.length === 0) return; // first commit of the allowlist
```

Re-run: both PASS.

- [ ] **Step 5: Write `lib/repo/base.ts`**

```ts
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";

export interface Repo<Row extends { id: number }> {
  get(organizationId: number, id: number): Row | undefined;
  list(organizationId: number, where?: Partial<Row>): Row[];
  insert(organizationId: number, row: Omit<Row, "id">): number;
  patch(organizationId: number, id: number, fields: Partial<Row>): void;
  db(): DatabaseSync;
}

export function makeRepo<Row extends { id: number }>(
  table: string,
  opts: { tenant: boolean }
): Repo<Row> {
  const tenantClause = opts.tenant ? " AND organization_id = ?" : "";
  const tenantArgs = (organizationId: number) => (opts.tenant ? [organizationId] : []);

  return {
    db: () => getDb(),

    get(organizationId, id) {
      return getDb()
        .prepare(`SELECT * FROM ${table} WHERE id = ?${tenantClause}`)
        .get(id, ...tenantArgs(organizationId)) as Row | undefined;
    },

    list(organizationId, where = {}) {
      const keys = Object.keys(where);
      const conds = keys.map((k) => `${k} = ?`).join(" AND ");
      const sql =
        `SELECT * FROM ${table} WHERE 1 = 1` +
        (conds ? ` AND ${conds}` : "") +
        tenantClause;
      return getDb()
        .prepare(sql)
        .all(...keys.map((k) => (where as Record<string, unknown>)[k]), ...tenantArgs(organizationId)) as Row[];
    },

    insert(organizationId, row) {
      const data: Record<string, unknown> = { ...row };
      if (opts.tenant) data.organization_id = organizationId;
      const cols = Object.keys(data);
      const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      return Number(getDb().prepare(sql).run(...cols.map((c) => data[c])).lastInsertRowid);
    },

    patch(organizationId, id, fields) {
      const cols = Object.keys(fields);
      if (cols.length === 0) return;
      const sql =
        `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} ` +
        `WHERE id = ?${tenantClause}`;
      getDb()
        .prepare(sql)
        .run(...cols.map((c) => (fields as Record<string, unknown>)[c]), id, ...tenantArgs(organizationId));
    },
  };
}
```

- [ ] **Step 6: Write `lib/repo/README.md`**

```markdown
# lib/repo

The only place in the codebase where new raw SQL is allowed.

- New feature code talks to the database through a repo module here, never
  `getDb().prepare(...)` in a route or a `lib/` file outside this folder.
- `tests/repo-boundary.test.ts` enforces it: any `.prepare(` / `.exec("<sql>")`
  in a new file under `app/` or `lib/` fails the build unless the file is on
  `tests/fixtures/raw-sql-allowlist.txt`.
- That allowlist is the 71 files that predate this rule (Phase 0b). It **only
  shrinks**. When a later phase touches one of those files, move its queries
  into a repo module and delete the line.
- The eventual Postgres migration replaces `base.ts`'s driver and nothing else.
- Every tenant repo takes `organizationId` as a required first argument and
  applies `WHERE organization_id = ?` on every read and `organization_id = ?`
  on every write. A forgotten scope is a compile error, not a silent leak.
```

- [ ] **Step 7: Add `lib/repo/base.ts` to the allowlist? No — it lives under `lib/repo/`**

The boundary test already exempts `lib/repo/`. Confirm `lib/repo/base.ts` is **not** added to `raw-sql-allowlist.txt`.

- [ ] **Step 8: Full check**

Run: `npx tsc --noEmit && npx eslint && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/repo/ tests/repo-boundary.test.ts tests/fixtures/raw-sql-allowlist.txt
git commit -m "Add a scoped lib/repo layer and a gate against new raw SQL"
```

---

### Task 4: M2 customers schema + `status` → `lifecycle` migration

**Files:**
- Modify: `lib/db.ts` (customers table-rebuild migration)
- Modify: `lib/types.ts` (customer row type + `customerStatusColor` → lifecycle)
- Test: `tests/customer-lifecycle-migration.test.ts` (create)

**Interfaces:**
- Consumes: the table-rebuild pattern in `lib/db.ts` (see `rebuildForTenantUnique` and the `users_role_new` block ~line 857).
- Produces: `customers` gains `customer_type`, `lifecycle` (NOT NULL DEFAULT `'lead'`), `parent_customer_id`, `payment_terms_days` (DEFAULT 0), `hard_credit_block` (DEFAULT 0), `qualified_at`, `first_order_at`; loses `status`. New type exports in `lib/types.ts`:
  ```ts
  export type CustomerLifecycle = "lead" | "qualified" | "sampled" | "active" | "dormant" | "lost" | "blocked";
  export type CustomerType = "RESTAURANT" | "HOTEL" | "CATERING" | "CAFE" | "RETAIL" | "WHOLESALE" | "OTHER";
  ```

- [ ] **Step 1: Write the migration test**

Create `tests/customer-lifecycle-migration.test.ts` (temp-db preamble as in `tests/tenancy-readers.test.ts`):

```ts
// preamble: temp COVERAGE_DB_PATH, SESSION_SECRET, afterAll cleanup
const { getDb } = await import("@/lib/db");

describe("customers M2 migration", () => {
  it("adds the lifecycle columns and drops status", () => {
    const cols = (getDb().prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ["customer_type", "lifecycle", "parent_customer_id", "payment_terms_days", "hard_credit_block", "qualified_at", "first_order_at"]) {
      expect(cols, `missing ${c}`).toContain(c);
    }
    expect(cols).not.toContain("status");
  });

  it("defaults lifecycle to 'lead' and enforces the enum", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (5,'F','f','2026-01-01')`);
    db.exec(`INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('K1','x','2026-01-01',5)`);
    const row = db.prepare("SELECT lifecycle FROM customers WHERE customer_code='K1'").get() as { lifecycle: string };
    expect(row.lifecycle).toBe("lead");
    expect(() =>
      db.exec(`INSERT INTO customers (customer_code, business_name, lifecycle, synced_at, organization_id) VALUES ('K2','x','bogus','2026-01-01',5)`)
    ).toThrow();
  });
});
```

- [ ] **Step 2: Write the real-data mapping test**

Add to the same file — this runs only when `ROUTEFLOW_MIGRATION_CHECK_DB` is set (see `tests/tenancy-schema.test.ts` for the pattern of reading that env var *before* importing `lib/db`):

```ts
it.runIf(!!process.env.ROUTEFLOW_MIGRATION_CHECK_DB)(
  "maps every real status value to a valid lifecycle", () => {
    const db = getDb();
    const bad = db.prepare(
      "SELECT DISTINCT lifecycle FROM customers WHERE lifecycle NOT IN ('lead','qualified','sampled','active','dormant','lost','blocked')"
    ).all();
    expect(bad).toEqual([]);
    // Spot-check the known mapping
    const active = db.prepare("SELECT COUNT(*) n FROM customers WHERE lifecycle='active'").get() as { n: number };
    expect(active.n).toBeGreaterThanOrEqual(89); // فعال + مشتری فعال in the 2026-09-01 backup
  }
);
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/customer-lifecycle-migration.test.ts`
Expected: FAIL — columns absent, `status` still present.

- [ ] **Step 4: Write the migration in `lib/db.ts`**

In the migration block, guarded on `PRAGMA table_info(customers)` not already containing `lifecycle`, rebuild `customers`:

```ts
const customerCols = (db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name);
if (!customerCols.includes("lifecycle")) {
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      CREATE TABLE customers_m2_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_code TEXT NOT NULL,
        business_name TEXT NOT NULL,
        contact_person TEXT, phone TEXT, address TEXT, city TEXT, province TEXT,
        lat REAL, lng REAL, salesperson TEXT,
        debt_0_7 REAL DEFAULT 0, debt_8_30 REAL DEFAULT 0, debt_30_plus REAL DEFAULT 0,
        notes TEXT, synced_at TEXT NOT NULL,
        last_purchase_date TEXT,
        group_id INTEGER REFERENCES groups(id),
        credit_limit_toman INTEGER,
        organization_id INTEGER REFERENCES organizations(id),
        customer_type TEXT CHECK (customer_type IN
          ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER')),
        lifecycle TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle IN
          ('lead','qualified','sampled','active','dormant','lost','blocked')),
        parent_customer_id INTEGER REFERENCES customers(id),
        payment_terms_days INTEGER NOT NULL DEFAULT 0,
        hard_credit_block INTEGER NOT NULL DEFAULT 0,
        qualified_at TEXT,
        first_order_at TEXT,
        UNIQUE (organization_id, customer_code)
      );
      INSERT INTO customers_m2_new
        (id, customer_code, business_name, contact_person, phone, address, city, province,
         lat, lng, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes, synced_at,
         last_purchase_date, group_id, credit_limit_toman, organization_id, lifecycle)
      SELECT
        id, customer_code, business_name, contact_person, phone, address, city, province,
        lat, lng, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes, synced_at,
        last_purchase_date, group_id, credit_limit_toman, organization_id,
        CASE TRIM(COALESCE(status,''))
          WHEN 'فعال' THEN 'active'
          WHEN 'مشتری فعال' THEN 'active'
          WHEN 'در حال پیگیری' THEN 'qualified'
          WHEN 'نمونه داده شد' THEN 'sampled'
          WHEN 'سرنخ' THEN 'lead'
          WHEN 'غیرفعال' THEN 'dormant'
          WHEN '' THEN 'lead'
          ELSE 'lead'
        END
      FROM customers;
      DROP TABLE customers;
      ALTER TABLE customers_m2_new RENAME TO customers;
      UPDATE customers
        SET first_order_at = (SELECT MIN(o.order_date) FROM orders o WHERE o.customer_id = customers.id)
        WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id);
    `);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
  // Log any status value that fell through to the ELSE branch, for the record.
  console.info("[migrate] customers.status -> lifecycle mapping applied; unknown values defaulted to 'lead'");
}
```

> Recreate any index that existed on `customers` (check `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='customers'` before writing — reproduce each `CREATE INDEX` after the `RENAME`).

- [ ] **Step 5: Update `lib/types.ts`**

- Add the `CustomerLifecycle` / `CustomerType` unions.
- Change the customer row interface: replace `status: string | null` with `lifecycle: CustomerLifecycle` and add the new optional fields.
- Replace `customerStatusColor(status)` with `customerLifecycleColor(lifecycle: CustomerLifecycle)` mapping: `active`→`--good`, `qualified`/`sampled`→`--accent`, `lead`→`--text-muted`, `dormant`→`--warn`, `lost`/`blocked`→`--crit`. Update its one caller region in `components/CustomerDetailPanel.tsx` (Task 6 wires the panel fully; here just keep `tsc` green — a mechanical rename).

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/customer-lifecycle-migration.test.ts`
Expected: PASS (the two always-on `it`s). Then the real-data check:

```bash
python3 - <<'PY'
import sqlite3, shutil
src = sqlite3.connect("data/backups/pre-tenancy-20260901-224428.db")
dst = sqlite3.connect("/tmp/claude-0/scratch-m2.db")
src.backup(dst); dst.close(); src.close()
PY
ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/claude-0/scratch-m2.db npx vitest run tests/customer-lifecycle-migration.test.ts
```
Expected: the `runIf` test PASSES (all lifecycle values valid, ≥89 active).

- [ ] **Step 7: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add lib/db.ts lib/types.ts tests/customer-lifecycle-migration.test.ts
git commit -m "Give customers a lifecycle, type, and credit terms; retire status"
```

---

### Task 5: Fold existing lead pins into `customers`

**Files:**
- Modify: `lib/db.ts` (one-time data migration, guarded on a marker row)
- Test: `tests/lead-pin-foldin.test.ts` (create)

**Interfaces:**
- Consumes: `saved_locations`, `lead_list_items`, the `LEAD-<id>` code scheme used by `app/api/locations/[id]/convert/route.ts`.
- Produces: every `saved_locations` row referenced by a `lead_list_items` row becomes a `customers` row (`lifecycle='lead'`, `customer_code='LEAD-<saved_location.id>'`), and the source `saved_locations` + `lead_list_items` rows are deleted. Idempotent.

- [ ] **Step 1: Write the test**

Create `tests/lead-pin-foldin.test.ts` (temp-db preamble):

```ts
const { getDb } = await import("@/lib/db");

describe("lead-pin fold-in", () => {
  it("converts pinned leads to customers and clears the pins", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (3,'T','t','2026-01-01')`);
    db.exec(`INSERT INTO groups (id,name,slug,created_at,organization_id) VALUES (30,'G','g','2026-01-01',3)`);
    // A pin in a lead list...
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, address, lat, lng, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (900, 'رستوران تست', 'https://maps.example/x', 'جایی', 35.7, 51.4, 'manual', 30, '2026-01-01','2026-01-01', 3)`);
    db.exec(`INSERT INTO lead_lists (id, name, created_at, updated_at) VALUES (40, 'L', '2026-01-01','2026-01-01')`);
    db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 900, 0, '2026-01-01')`);
    // ...and a pin NOT in any list (should be left alone)
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (901, 'رها', 'https://maps.example/y', 'manual', 30, '2026-01-01','2026-01-01', 3)`);

    // re-run the migration entrypoint (exported for the test) — see Step 3
    const { foldLeadPinsIntoCustomers } = require("@/lib/db");
    foldLeadPinsIntoCustomers(db);

    const cust = db.prepare("SELECT customer_code, lifecycle, organization_id, group_id FROM customers WHERE customer_code='LEAD-900'").get() as
      { customer_code: string; lifecycle: string; organization_id: number; group_id: number } | undefined;
    expect(cust).toMatchObject({ lifecycle: "lead", organization_id: 3, group_id: 30 });
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=900").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM lead_list_items WHERE location_id=900").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=901").get()).toBeTruthy(); // untouched

    // idempotent
    expect(() => foldLeadPinsIntoCustomers(db)).not.toThrow();
    expect(db.prepare("SELECT COUNT(*) n FROM customers WHERE customer_code='LEAD-900'").get()).toMatchObject({ n: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lead-pin-foldin.test.ts`
Expected: FAIL — `foldLeadPinsIntoCustomers` is not exported.

- [ ] **Step 3: Implement `foldLeadPinsIntoCustomers(db)` in `lib/db.ts`**

```ts
export function foldLeadPinsIntoCustomers(db: DatabaseSync): void {
  const pins = db.prepare(`
    SELECT DISTINCT s.*
    FROM saved_locations s
    JOIN lead_list_items i ON i.location_id = s.id
  `).all() as Array<{
    id: number; name: string; address: string | null; lat: number | null; lng: number | null;
    notes?: string | null; group_id: number | null; organization_id: number;
  }>;

  const insert = db.prepare(`
    INSERT INTO customers (customer_code, business_name, address, lat, lng, notes,
                           lifecycle, group_id, organization_id, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?)
    ON CONFLICT (organization_id, customer_code) DO NOTHING
  `);
  const now = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const p of pins) {
      insert.run(`LEAD-${p.id}`, p.name, p.address ?? null, p.lat, p.lng,
        p.notes ?? null, p.group_id, p.organization_id, now);
      db.prepare("DELETE FROM lead_list_items WHERE location_id = ?").run(p.id);
      db.prepare("DELETE FROM saved_locations WHERE id = ?").run(p.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
```

Call it once from the migration block, guarded on a marker so it never re-runs on a healthy DB but stays safe if it does:

```ts
const foldDone = db.prepare("SELECT value FROM app_meta WHERE key = 'lead_pin_foldin_done'").get() as { value: string } | undefined;
if (!foldDone) {
  foldLeadPinsIntoCustomers(db);
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('lead_pin_foldin_done', ?)").run(new Date().toISOString());
}
```

> If `app_meta` does not exist, create it in this migration (`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`) and add it to the `tests/tenancy-schema.test.ts` exempt list (it is infrastructure, not tenant data).

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/lead-pin-foldin.test.ts`
Expected: PASS.

- [ ] **Step 5: Real-data dry check**

```bash
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("data/backups/pre-tenancy-20260901-224428.db")
print("pins in lists:", c.execute("SELECT COUNT(DISTINCT location_id) FROM lead_list_items").fetchone()[0])
PY
```
Record the count in the commit body (how many customers the deploy will create).

- [ ] **Step 6: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add lib/db.ts tests/lead-pin-foldin.test.ts
git commit -m "Fold pinned leads into customers as lifecycle='lead'"
```

---

### Task 6: `lib/repo/customers.ts` + lifecycle transitions + panel wiring

**Files:**
- Create: `lib/repo/customers.ts`, `lib/customerLifecycle.ts`
- Create: `app/api/customers/[id]/lifecycle/route.ts`
- Modify: `components/CustomerDetailPanel.tsx`
- Test: `tests/customer-lifecycle.test.ts`, `tests/api/customer-lifecycle-route.test.ts`

**Interfaces:**
- Consumes: `makeRepo` from `lib/repo/base.ts`; `Session` / `requireRole` from `lib/session.ts`.
- Produces:
  - `lib/customerLifecycle.ts` — `export const LIFECYCLE_TRANSITIONS: Record<CustomerLifecycle, CustomerLifecycle[]>` and `export function canTransition(from: CustomerLifecycle, to: CustomerLifecycle): boolean`.
  - `lib/repo/customers.ts` — `export const customersRepo` (a `Repo<CustomerRow>`), plus `export function setLifecycle(organizationId: number, id: number, to: CustomerLifecycle): void` (throws `LifecycleError` on an illegal transition) and `export function setCustomerType(organizationId, id, type: CustomerType): void`, `setCreditTerms(organizationId, id, { payment_terms_days?, credit_limit_toman?, hard_credit_block? }): void`.

- [ ] **Step 1: Write `lib/customerLifecycle.ts` test**

`tests/customer-lifecycle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canTransition } from "@/lib/customerLifecycle";

describe("customer lifecycle transitions", () => {
  it("allows the forward path and re-engagement", () => {
    expect(canTransition("lead", "qualified")).toBe(true);
    expect(canTransition("qualified", "sampled")).toBe(true);
    expect(canTransition("sampled", "active")).toBe(true);
    expect(canTransition("lead", "sampled")).toBe(false);      // skips qualified
    expect(canTransition("active", "dormant")).toBe(true);
    expect(canTransition("dormant", "active")).toBe(true);
    expect(canTransition("lost", "lead")).toBe(true);
    expect(canTransition("active", "blocked")).toBe(true);
    expect(canTransition("blocked", "active")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify fail** (`npx vitest run tests/customer-lifecycle.test.ts` → module missing)

- [ ] **Step 3: Write `lib/customerLifecycle.ts`**

```ts
import type { CustomerLifecycle } from "@/lib/types";

export const LIFECYCLE_TRANSITIONS: Record<CustomerLifecycle, CustomerLifecycle[]> = {
  lead:      ["qualified", "lost", "blocked"],
  qualified: ["sampled", "active", "lost", "blocked"],
  sampled:   ["active", "lost", "blocked"],
  active:    ["dormant", "lost", "blocked"],
  dormant:   ["active", "lost", "blocked"],
  lost:      ["lead", "blocked"],
  blocked:   ["active"],
};

export function canTransition(from: CustomerLifecycle, to: CustomerLifecycle): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Write `lib/repo/customers.ts` + its test**

`tests/customer-lifecycle.test.ts` — add (temp-db preamble at top of file):

```ts
const { getDb } = await import("@/lib/db");
const { setLifecycle, LifecycleError } = await import("@/lib/repo/customers");

it("setLifecycle enforces the transition table", () => {
  const db = getDb();
  db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (7,'S','s','2026-01-01')`);
  db.exec(`INSERT INTO customers (id, customer_code, business_name, lifecycle, synced_at, organization_id)
           VALUES (500, 'C500', 'x', 'lead', '2026-01-01', 7)`);
  setLifecycle(7, 500, "qualified");
  expect((db.prepare("SELECT lifecycle FROM customers WHERE id=500").get() as { lifecycle: string }).lifecycle).toBe("qualified");
  expect(() => setLifecycle(7, 500, "active")).not.toThrow();       // qualified->active legal
  expect(() => setLifecycle(7, 500, "lead")).toThrow(LifecycleError); // active->lead illegal
  expect(() => setLifecycle(999, 500, "dormant")).toThrow();         // wrong org -> not found
});
```

Implementation `lib/repo/customers.ts`:

```ts
import { makeRepo } from "./base";
import { canTransition } from "@/lib/customerLifecycle";
import type { CustomerLifecycle, CustomerType } from "@/lib/types";

export class LifecycleError extends Error {}

interface CustomerRow {
  id: number;
  lifecycle: CustomerLifecycle;
  customer_type: CustomerType | null;
  payment_terms_days: number;
  hard_credit_block: number;
  credit_limit_toman: number | null;
  qualified_at: string | null;
  // ...other columns are present but not needed by name here
}

export const customersRepo = makeRepo<CustomerRow>("customers", { tenant: true });

export function setLifecycle(organizationId: number, id: number, to: CustomerLifecycle): void {
  const row = customersRepo.get(organizationId, id);
  if (!row) throw new LifecycleError("مشتری پیدا نشد");
  if (!canTransition(row.lifecycle, to)) {
    const legal = Object.keys(require("@/lib/customerLifecycle").LIFECYCLE_TRANSITIONS[row.lifecycle] ?? {});
    throw new LifecycleError(`گذار از «${row.lifecycle}» به «${to}» مجاز نیست`);
  }
  const patch: Partial<CustomerRow> = { lifecycle: to };
  if (to === "qualified" && !row.qualified_at) patch.qualified_at = new Date().toISOString();
  customersRepo.patch(organizationId, id, patch);
}

export function setCustomerType(organizationId: number, id: number, type: CustomerType): void {
  customersRepo.patch(organizationId, id, { customer_type: type });
}

export function setCreditTerms(
  organizationId: number,
  id: number,
  terms: { payment_terms_days?: number; credit_limit_toman?: number | null; hard_credit_block?: boolean }
): void {
  const patch: Partial<CustomerRow> = {};
  if (terms.payment_terms_days !== undefined) patch.payment_terms_days = terms.payment_terms_days;
  if (terms.credit_limit_toman !== undefined) patch.credit_limit_toman = terms.credit_limit_toman;
  if (terms.hard_credit_block !== undefined) patch.hard_credit_block = terms.hard_credit_block ? 1 : 0;
  customersRepo.patch(organizationId, id, patch);
}
```

- [ ] **Step 6: Run — verify pass** (`npx vitest run tests/customer-lifecycle.test.ts`)

- [ ] **Step 7: The API route + test**

`app/api/customers/[id]/lifecycle/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { setLifecycle, LifecycleError } from "@/lib/repo/customers";
import type { CustomerLifecycle } from "@/lib/types";

const VALID: CustomerLifecycle[] = ["lead","qualified","sampled","active","dormant","lost","blocked"];

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/lifecycle">) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { lifecycle?: string } | null;
  if (!body?.lifecycle || !VALID.includes(body.lifecycle as CustomerLifecycle)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }
  try {
    setLifecycle(guard.session.organizationId, Number(id), body.lifecycle as CustomerLifecycle);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
```

`tests/api/customer-lifecycle-route.test.ts` — follows `tests/api/facilities-route.test.ts`: seed an owner + a customer, `PATCH` with a legal then an illegal transition, assert 200 then 409. Assert a customer in another org answers 409/404 (not found), never 200.

- [ ] **Step 8: Wire `components/CustomerDetailPanel.tsx`**

- Replace the `customer.status` / `StatusPill` display with `customer.lifecycle` via `customerLifecycleColor` (from Task 4).
- Add a small lifecycle control (a `<select>` or a row of pills) visible to `owner`/`group_manager`/`salesperson`, listing only `LIFECYCLE_TRANSITIONS[customer.lifecycle]` plus the current value; on change, `fetch("/api/customers/${id}/lifecycle", { method: "PATCH", body: JSON.stringify({ lifecycle }) })`, toast on 409 with the server message, refresh on 200.
- No new customer-type / credit UI in this task (fields exist; a later phase surfaces them). Keep the panel's other behaviour untouched.

- [ ] **Step 9: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add lib/repo/customers.ts lib/customerLifecycle.ts app/api/customers/ components/CustomerDetailPanel.tsx tests/customer-lifecycle.test.ts tests/api/customer-lifecycle-route.test.ts
git commit -m "Move customer lifecycle behind lib/repo with an enforced transition table"
```

---

### Task 7: The `rep_manager` role

**Files:**
- Modify: `lib/roles.ts`, `scripts/create-user.mjs`
- Modify: `lib/db.ts` (widen `users.role` CHECK — table-rebuild, mirror the `platform_owner` widening ~line 922)
- Modify: `lib/session.ts` (make sure `rep_manager` falls through to "sees no group data" safely; add to any `requireRole` list that should include it — none in this task beyond representatives routes, added in Task 9)
- Test: `tests/rep-manager-role.test.ts`

**Interfaces:**
- Consumes: the `users_platform_new` rebuild block in `lib/db.ts`.
- Produces: `Role` union gains `"rep_manager"`; `ROLES`, `ROLE_LABEL`, `ROLE_DESCRIPTION` gain an entry; `scripts/create-user.mjs`'s `ROLES` array gains it; `users.role` CHECK admits it.

- [ ] **Step 1: Write the test**

`tests/rep-manager-role.test.ts` (temp-db preamble):

```ts
const { getDb } = await import("@/lib/db");
import { ROLES, ROLE_LABEL } from "@/lib/roles";
const { scopeGroupIds } = await import("@/lib/session");

describe("rep_manager role", () => {
  it("is in the roles module with a label and description", () => {
    expect(ROLES).toContain("rep_manager");
    expect(ROLE_LABEL.rep_manager).toBeTruthy();
  });

  it("is admitted by the users.role CHECK", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (8,'R','r','2026-01-01')`);
    expect(() =>
      db.exec(`INSERT INTO users (username, password_hash, display_name, role, organization_id, active, created_at)
               VALUES ('rm1','x','مدیر','rep_manager',8,1,'2026-01-01')`)
    ).not.toThrow();
  });

  it("sees no group territory by default", () => {
    const s = { user: { id: 1 } as never, role: "rep_manager" as never, groupId: null, organizationId: 8 };
    expect(scopeGroupIds(s)).toEqual([]); // not "all", not a crash
  });
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Edit `lib/roles.ts`**

Add `"rep_manager"` to the `Role` union (after `group_manager`), to `ROLES` (after `group_manager`), and:

```ts
ROLE_LABEL.rep_manager = "مدیر نمایندگان";
ROLE_DESCRIPTION.rep_manager = "نمایندگان سازمان خودش — پروفایل، مراحل پذیرش و اهداف؛ بدون دسترسی به مناطق گروه‌ها";
```

(Write them inline in the object literals, not as assignments — match the existing style.)

- [ ] **Step 4: Edit `scripts/create-user.mjs`**

Add `"rep_manager"` to the `ROLES` array and to the usage string. In the group-id logic: `rep_manager`, like `owner`, needs no `group_id` — change `const groupId = role === "owner" ? null : Number(groupArg);` to `const groupId = (role === "owner" || role === "rep_manager") ? null : Number(groupArg);` and the matching `if (role !== "owner" && ...)` guard to `if (role !== "owner" && role !== "rep_manager" && ...)`.

- [ ] **Step 5: Widen `users.role` CHECK in `lib/db.ts`**

Find the `users_platform_new` rebuild (~line 922, guarded `!usersPlatformSchema.sql.includes("platform_owner")`). Add a parallel block guarded on `!schema.sql.includes("rep_manager")` that rebuilds `users` with:

```sql
CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'salesperson', 'driver'))
```

copying all columns across (same `INSERT INTO users_repmgr_new (...) SELECT ... FROM users; DROP; RENAME` shape as the existing block). Reproduce the same indexes.

- [ ] **Step 6: Confirm `lib/session.ts` is safe**

`scopeGroupIds`: a `rep_manager` is not `platform_owner` and not `owner`, so it reaches the non-owner path which uses `session.groupId` (null) → returns `[]`. No edit needed. Confirm by reading lines 78–95. `canReachOrg` already returns `organizationId === session.organizationId` for any non-`platform_owner`. Add a one-line comment at the non-owner branch noting `rep_manager` lands here deliberately.

- [ ] **Step 7: Run — verify pass** (`npx vitest run tests/rep-manager-role.test.ts` and the existing `tests/roles-*` / drift test)

- [ ] **Step 8: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add lib/roles.ts scripts/create-user.mjs lib/db.ts lib/session.ts tests/rep-manager-role.test.ts
git commit -m "Add the rep_manager role"
```

---

### Task 8: `representative_profiles` + onboarding steps + stage machine

**Files:**
- Modify: `lib/db.ts` (two `CREATE TABLE IF NOT EXISTS`; add both to migration; add `representative_profiles` to `TENANT_TABLES`)
- Create: `lib/repStages.ts`, `lib/repOnboarding.ts`, `lib/repo/representatives.ts`
- Modify: `tests/tenancy-schema.test.ts` (exempt list: add `"representative_onboarding_steps"`)
- Test: `tests/representatives.test.ts`

**Interfaces:**
- Consumes: `makeRepo`; `TENANT_TABLES` from `lib/db.ts`.
- Produces:
  - `lib/repStages.ts` — `export const REP_STAGE_TRANSITIONS: Record<RepStage, RepStage[]>`, `export function canAdvance(from, to): boolean`, `RepStage` type.
  - `lib/repOnboarding.ts` — `export const ONBOARDING_STEPS: { step_code: string; label_fa: string; required: boolean; sort_order: number }[]`.
  - `lib/repo/representatives.ts` — `export const repsRepo`, `export function createRepresentative(organizationId, input): number` (inserts profile + seeds onboarding steps in one transaction), `export function advanceStage(organizationId, repId, to: RepStage): void` (throws `RepStageError`; guards `→ 'active'` on all required steps complete), `export function completeStep(organizationId, repId, stepCode, userId): void`, `export function listOnboarding(organizationId, repId): OnboardingStepRow[]`.

- [ ] **Step 1: Write `tests/representatives.test.ts`** (temp-db preamble)

```ts
const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { createRepresentative, advanceStage, completeStep, RepStageError } = await import("@/lib/repo/representatives");
const { ONBOARDING_STEPS } = await import("@/lib/repOnboarding");

function seedOrgCustomer(orgId: number, code: string): number {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${orgId},'O${orgId}','o${orgId}','2026-01-01')`);
  return Number(db.prepare(
    "INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, organization_id) VALUES (?,?,'WHOLESALE','qualified','2026-01-01',?)"
  ).run(code, "نماینده تست", orgId).lastInsertRowid);
}

describe("representative_profiles", () => {
  it("is a tenant table", () => {
    expect(TENANT_TABLES).toContain("representative_profiles");
  });

  it("createRepresentative seeds the standard onboarding steps", () => {
    const custId = seedOrgCustomer(2, "REP-A");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-A", manager_user_id: null });
    const steps = getDb().prepare("SELECT step_code FROM representative_onboarding_steps WHERE representative_id=?").all(repId);
    expect(steps.length).toBe(ONBOARDING_STEPS.length);
  });

  it("blocks stage -> active until required steps are done, then allows it", () => {
    const custId = seedOrgCustomer(2, "REP-B");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-B", manager_user_id: null });
    // walk prospect -> ... -> approved -> onboarding legally
    for (const to of ["qualified","negotiating","documents","approved","onboarding"] as const) advanceStage(2, repId, to);
    expect(() => advanceStage(2, repId, "active")).toThrow(RepStageError);
    for (const s of ONBOARDING_STEPS.filter((s) => s.required)) completeStep(2, repId, s.step_code, 1);
    expect(() => advanceStage(2, repId, "active")).not.toThrow();
  });

  it("rejects an illegal stage jump", () => {
    const custId = seedOrgCustomer(2, "REP-C");
    const repId = createRepresentative(2, { customer_id: custId, rep_code: "R-C", manager_user_id: null });
    expect(() => advanceStage(2, repId, "active")).toThrow(RepStageError); // prospect -> active
  });
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Add the tables + migration to `lib/db.ts`**

Add both `CREATE TABLE IF NOT EXISTS` from the spec (§4) to the schema block. Add `"representative_profiles"` to the `TENANT_TABLES` array. The `CREATE TABLE IF NOT EXISTS` in the always-run schema block *is* the migration (idempotent); no rebuild needed since these are new.

- [ ] **Step 4: Write `lib/repStages.ts`**

```ts
export type RepStage =
  | "prospect" | "qualified" | "negotiating" | "documents"
  | "approved" | "onboarding" | "active" | "dormant" | "terminated";

export const REP_STAGE_TRANSITIONS: Record<RepStage, RepStage[]> = {
  prospect:    ["qualified", "terminated"],
  qualified:   ["negotiating", "terminated"],
  negotiating: ["documents", "terminated"],
  documents:   ["approved", "terminated"],
  approved:    ["onboarding", "terminated"],
  onboarding:  ["active", "terminated"],
  active:      ["dormant", "terminated"],
  dormant:     ["active", "terminated"],
  terminated:  [],
};

export function canAdvance(from: RepStage, to: RepStage): boolean {
  return REP_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}
```

- [ ] **Step 5: Write `lib/repOnboarding.ts`**

```ts
export const ONBOARDING_STEPS: { step_code: string; label_fa: string; required: boolean; sort_order: number }[] = [
  { step_code: "contract_signed",     label_fa: "امضای قرارداد",              required: true,  sort_order: 1 },
  { step_code: "territory_assigned",  label_fa: "تخصیص منطقهٔ فعالیت",         required: true,  sort_order: 2 },
  { step_code: "price_list_assigned", label_fa: "تعیین لیست قیمت نماینده",     required: true,  sort_order: 3 },
  { step_code: "credit_terms_set",    label_fa: "تعیین شرایط پرداخت",          required: true,  sort_order: 4 },
  { step_code: "first_stock_order",   label_fa: "ثبت اولین سفارش تأمین",       required: true,  sort_order: 5 },
  { step_code: "training_module_6",   label_fa: "گذراندن دورهٔ آموزش نماینده", required: false, sort_order: 6 },
];
```

- [ ] **Step 6: Write `lib/repo/representatives.ts`**

```ts
import { makeRepo } from "./base";
import { canAdvance, type RepStage } from "@/lib/repStages";
import { ONBOARDING_STEPS } from "@/lib/repOnboarding";

export class RepStageError extends Error {}

interface RepRow {
  id: number; customer_id: number; rep_code: string; manager_user_id: number | null;
  stage: RepStage; activated_at: string | null; created_at: string; updated_at: string;
}
interface OnboardingStepRow {
  id: number; representative_id: number; step_code: string; label_fa: string;
  required: number; sort_order: number; completed_at: string | null; completed_by: number | null; notes: string | null;
}

export const repsRepo = makeRepo<RepRow>("representative_profiles", { tenant: true });

export function createRepresentative(
  organizationId: number,
  input: { customer_id: number; rep_code: string; manager_user_id: number | null }
): number {
  const db = repsRepo.db();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const repId = Number(db.prepare(`
      INSERT INTO representative_profiles
        (organization_id, customer_id, rep_code, manager_user_id, stage, credit_terms_days, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'prospect', 0, ?, ?)
    `).run(organizationId, input.customer_id, input.rep_code, input.manager_user_id, now, now).lastInsertRowid);

    const step = db.prepare(`
      INSERT INTO representative_onboarding_steps (representative_id, step_code, label_fa, required, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const s of ONBOARDING_STEPS) step.run(repId, s.step_code, s.label_fa, s.required ? 1 : 0, s.sort_order);
    db.exec("COMMIT");
    return repId;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listOnboarding(organizationId: number, repId: number): OnboardingStepRow[] {
  // ownership check via repsRepo.get first
  if (!repsRepo.get(organizationId, repId)) throw new RepStageError("نماینده پیدا نشد");
  return repsRepo.db()
    .prepare("SELECT * FROM representative_onboarding_steps WHERE representative_id = ? ORDER BY sort_order")
    .all(repId) as OnboardingStepRow[];
}

export function completeStep(organizationId: number, repId: number, stepCode: string, userId: number): void {
  if (!repsRepo.get(organizationId, repId)) throw new RepStageError("نماینده پیدا نشد");
  repsRepo.db()
    .prepare("UPDATE representative_onboarding_steps SET completed_at = ?, completed_by = ? WHERE representative_id = ? AND step_code = ?")
    .run(new Date().toISOString(), userId, repId, stepCode);
}

export function advanceStage(organizationId: number, repId: number, to: RepStage): void {
  const rep = repsRepo.get(organizationId, repId);
  if (!rep) throw new RepStageError("نماینده پیدا نشد");
  if (!canAdvance(rep.stage, to)) throw new RepStageError(`گذار از «${rep.stage}» به «${to}» مجاز نیست`);
  if (to === "active") {
    const pending = repsRepo.db().prepare(
      "SELECT COUNT(*) n FROM representative_onboarding_steps WHERE representative_id = ? AND required = 1 AND completed_at IS NULL"
    ).get(repId) as { n: number };
    if (pending.n > 0) throw new RepStageError(`${pending.n} مرحلهٔ پذیرش هنوز کامل نشده است`);
  }
  const patch: Partial<RepRow> = { stage: to, updated_at: new Date().toISOString() };
  if (to === "active" && !rep.activated_at) patch.activated_at = new Date().toISOString();
  repsRepo.patch(organizationId, repId, patch);
}
```

- [ ] **Step 7: Run — verify pass** (`npx vitest run tests/representatives.test.ts`)

- [ ] **Step 8: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add lib/db.ts lib/repStages.ts lib/repOnboarding.ts lib/repo/representatives.ts tests/representatives.test.ts tests/tenancy-schema.test.ts
git commit -m "Add representative_profiles with a seeded onboarding checklist and stage machine"
```

---

### Task 9: Representatives admin API + page

**Files:**
- Create: `app/api/admin/representatives/route.ts` (GET list, POST create)
- Create: `app/api/admin/representatives/[id]/route.ts` (GET, PATCH: advance-stage / complete-step)
- Create: `app/sales/admin/representatives/page.tsx`
- Test: `tests/api/admin-representatives.test.ts`

**Interfaces:**
- Consumes: `createRepresentative`, `advanceStage`, `completeStep`, `listOnboarding`, `repsRepo` from `lib/repo/representatives.ts`; `requireRole` from `lib/session.ts`.
- Produces: routes gated to `["owner", "rep_manager"]`. Response shapes: `GET /` → `{ ok, representatives: RepRow[] }`; `GET /[id]` → `{ ok, representative: RepRow, onboarding: OnboardingStepRow[] }`; `PATCH /[id]` body `{ action: "advance", stage } | { action: "complete_step", step_code }`.

- [ ] **Step 1: Write `tests/api/admin-representatives.test.ts`**

Model on `tests/api/admin-groups.test.ts`: build an owner session cookie (`createSessionToken({ uid, role: "owner", gid: null, oid: 1, tv: 0, name: "م" })`), seed a `WHOLESALE` customer, then:
- `POST /api/admin/representatives` `{ customer_id, rep_code: "R1" }` → 200, body has an id; a second POST with the same `rep_code` → 409.
- `GET /api/admin/representatives` → list contains it.
- `GET /api/admin/representatives/<id>` → `onboarding.length === ONBOARDING_STEPS.length`.
- `PATCH …/<id>` `{ action: "advance", stage: "active" }` before steps done → 409 with a Persian message.
- A `rep_code` collision across orgs is allowed (seed org 2 rep with `rep_code: "R1"` directly, assert no error) — but a `salesperson` cookie hitting any of these → 403.

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Write `app/api/admin/representatives/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { repsRepo, createRepresentative } from "@/lib/repo/representatives";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const reps = repsRepo.list(guard.session.organizationId);
  return NextResponse.json({ ok: true, representatives: reps });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { customer_id?: number; rep_code?: string; manager_user_id?: number | null } | null;
  if (!body?.customer_id || !body?.rep_code?.trim()) {
    return NextResponse.json({ ok: false, error: "مشتری و کد نماینده لازم است" }, { status: 400 });
  }
  try {
    const id = createRepresentative(guard.session.organizationId, {
      customer_id: Number(body.customer_id),
      rep_code: body.rep_code.trim(),
      manager_user_id: body.manager_user_id ?? null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) {
      return NextResponse.json({ ok: false, error: "کد نماینده تکراری است" }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Write `app/api/admin/representatives/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { repsRepo, listOnboarding, advanceStage, completeStep, RepStageError } from "@/lib/repo/representatives";
import type { RepStage } from "@/lib/repStages";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/representatives/[id]">) {
  const guard = requireRole(req, ["owner", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const rep = repsRepo.get(guard.session.organizationId, Number(id));
  if (!rep) return NextResponse.json({ ok: false, error: "نماینده پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, representative: rep, onboarding: listOnboarding(guard.session.organizationId, Number(id)) });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/representatives/[id]">) {
  const guard = requireRole(req, ["owner", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { action: "advance"; stage: RepStage }
    | { action: "complete_step"; step_code: string }
    | null;
  try {
    if (body?.action === "advance") {
      advanceStage(guard.session.organizationId, Number(id), body.stage);
    } else if (body?.action === "complete_step") {
      completeStep(guard.session.organizationId, Number(id), body.step_code, guard.session.user.id);
    } else {
      return NextResponse.json({ ok: false, error: "کنش نامعتبر است" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RepStageError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
```

- [ ] **Step 5: Write `app/sales/admin/representatives/page.tsx`**

Server component in the shape of `app/sales/admin/groups/page.tsx`: resolve the session, redirect non-`owner`/`rep_manager`, read `repsRepo.list(session.organizationId)` directly, render a table (rep_code, linked customer business_name, stage as a pill, manager). A client sub-component provides the create form (`POST`) and a detail drawer that lists onboarding steps with a "تکمیل" button (`PATCH { action: "complete_step" }`) and a stage `<select>` limited to `REP_STAGE_TRANSITIONS[current]` (`PATCH { action: "advance" }`). Persian throughout. Add a nav link wherever `/sales/admin/groups` and `/sales/admin/users` are linked.

- [ ] **Step 6: Run — verify pass** (`npx vitest run tests/api/admin-representatives.test.ts`)

- [ ] **Step 7: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add app/api/admin/representatives/ app/sales/admin/representatives/ tests/api/admin-representatives.test.ts
git commit -m "Admin surface for representatives: create, advance stage, tick onboarding"
```

---

### Task 10: `credit_approvals` (direct customers only)

**Files:**
- Modify: `lib/db.ts` (`CREATE TABLE IF NOT EXISTS credit_approvals`; add to `TENANT_TABLES`)
- Create: `lib/repo/creditApprovals.ts`
- Create: `app/api/admin/credit-approvals/route.ts` (GET list, POST request), `app/api/admin/credit-approvals/[id]/decide/route.ts` (POST)
- Test: `tests/credit-approvals.test.ts`, `tests/api/credit-approvals-route.test.ts`

**Interfaces:**
- Consumes: `makeRepo`; `representative_profiles` (to reject rep customers).
- Produces: `lib/repo/creditApprovals.ts` — `export const creditApprovalsRepo`, `export function requestApproval(organizationId, input: { order_id; requested_by; customer_id; customer_balance_toman; credit_limit_toman: number | null }): number` (throws `CreditApprovalError` if the customer has a `representative_profiles` row), `export function decide(organizationId, id, verdict: "approved" | "rejected", decidedBy: number, reason?: string): void`, `export function listApprovals(organizationId, status?): CreditApprovalRow[]`.

- [ ] **Step 1: Write `tests/credit-approvals.test.ts`** (temp-db preamble)

```ts
const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { requestApproval, decide, CreditApprovalError } = await import("@/lib/repo/creditApprovals");

describe("credit_approvals", () => {
  it("is a tenant table", () => expect(TENANT_TABLES).toContain("credit_approvals"));

  it("records a request for a direct customer and decides it", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (9,'C','c','2026-01-01')`);
    const custId = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('D1','x','active','2026-01-01',9)").run().lastInsertRowid);
    const uId = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES ('u9','x','u','group_manager',9,1,'2026-01-01')").run().lastInsertRowid);
    const orderId = Number(db.prepare("INSERT INTO orders (order_no,customer_id,order_date,created_by,created_at,updated_at,organization_id) VALUES ('9001',?,?,?,?,?,9)").run(custId,"2026-01-01",uId,"2026-01-01","2026-01-01").lastInsertRowid);

    const id = requestApproval(9, { order_id: orderId, requested_by: uId, customer_id: custId, customer_balance_toman: 5_000_000, credit_limit_toman: 3_000_000 });
    const row = db.prepare("SELECT status, overage_toman FROM credit_approvals WHERE id=?").get(id) as { status: string; overage_toman: number };
    expect(row).toMatchObject({ status: "pending", overage_toman: 2_000_000 });

    decide(9, id, "approved", uId, "تأیید تلفنی مدیر");
    expect((db.prepare("SELECT status FROM credit_approvals WHERE id=?").get(id) as { status: string }).status).toBe("approved");
  });

  it("refuses a request for a representative customer", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (10,'C','cc','2026-01-01')`);
    const custId = Number(db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('W1','r','WHOLESALE','active','2026-01-01',10)").run().lastInsertRowid);
    db.prepare("INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (10,?,'RW','active',0,'2026-01-01','2026-01-01')").run(custId);
    const uId = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES ('u10','x','u','group_manager',10,1,'2026-01-01')").run().lastInsertRowid);
    const orderId = Number(db.prepare("INSERT INTO orders (order_no,customer_id,order_date,created_by,created_at,updated_at,organization_id) VALUES ('10001',?,?,?,?,?,10)").run(custId,"2026-01-01",uId,"2026-01-01","2026-01-01").lastInsertRowid);
    expect(() =>
      requestApproval(10, { order_id: orderId, requested_by: uId, customer_id: custId, customer_balance_toman: 1, credit_limit_toman: 0 })
    ).toThrow(CreditApprovalError);
  });
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Add the table to `lib/db.ts`** (from spec §5) + `"credit_approvals"` to `TENANT_TABLES`.

- [ ] **Step 4: Write `lib/repo/creditApprovals.ts`**

```ts
import { makeRepo } from "./base";

export class CreditApprovalError extends Error {}

interface CreditApprovalRow {
  id: number; order_id: number; requested_by: number; requested_at: string;
  customer_balance_toman: number; credit_limit_toman: number | null; overage_toman: number;
  status: "pending" | "approved" | "rejected" | "expired";
  decided_by: number | null; decided_at: string | null; reason: string | null;
}

export const creditApprovalsRepo = makeRepo<CreditApprovalRow>("credit_approvals", { tenant: true });

export function requestApproval(
  organizationId: number,
  input: { order_id: number; requested_by: number; customer_id: number; customer_balance_toman: number; credit_limit_toman: number | null }
): number {
  const db = creditApprovalsRepo.db();
  const isRep = db.prepare("SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?")
    .get(input.customer_id, organizationId);
  if (isRep) throw new CreditApprovalError("نماینده مشمول کنترل اعتبار نیست — تسویه با چک یا نقد است");
  const overage = Math.max(0, input.customer_balance_toman - (input.credit_limit_toman ?? 0));
  return Number(db.prepare(`
    INSERT INTO credit_approvals
      (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(organizationId, input.order_id, input.requested_by, new Date().toISOString(),
        input.customer_balance_toman, input.credit_limit_toman, overage).lastInsertRowid);
}

export function decide(
  organizationId: number, id: number, verdict: "approved" | "rejected", decidedBy: number, reason?: string
): void {
  const row = creditApprovalsRepo.get(organizationId, id);
  if (!row) throw new CreditApprovalError("درخواست پیدا نشد");
  if (row.status !== "pending") throw new CreditApprovalError("این درخواست قبلاً تعیین‌تکلیف شده است");
  creditApprovalsRepo.patch(organizationId, id, {
    status: verdict, decided_by: decidedBy, decided_at: new Date().toISOString(), reason: reason ?? null,
  });
}

export function listApprovals(organizationId: number, status?: CreditApprovalRow["status"]): CreditApprovalRow[] {
  return status
    ? creditApprovalsRepo.list(organizationId, { status } as Partial<CreditApprovalRow>)
    : creditApprovalsRepo.list(organizationId);
}
```

- [ ] **Step 5: Write the two routes**

`app/api/admin/credit-approvals/route.ts` — `GET` (`["owner","group_manager"]`, `?status=` filter) returns `listApprovals`; `POST` body `{ order_id, customer_id, customer_balance_toman, credit_limit_toman }` calls `requestApproval` with `requested_by = guard.session.user.id`; `CreditApprovalError` → 409.
`app/api/admin/credit-approvals/[id]/decide/route.ts` — `POST` body `{ verdict: "approved"|"rejected", reason? }` calls `decide`; `CreditApprovalError` → 409.

- [ ] **Step 6: `tests/api/credit-approvals-route.test.ts`** — owner/manager cookie, request → 200, decide → 200, decide again → 409, `salesperson` cookie → 403, another org's approval id → 404.

- [ ] **Step 7: Run — verify pass**

- [ ] **Step 8: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add lib/db.ts lib/repo/creditApprovals.ts app/api/admin/credit-approvals/ tests/credit-approvals.test.ts tests/api/credit-approvals-route.test.ts
git commit -m "Add credit_approvals with a manual decide surface for direct customers"
```

---

### Task 11: Demo-data purge hardening

**Files:**
- Modify: `scripts/seed-demo.mjs`
- Test: `tests/seed-demo-guard.test.ts` (create)

**Interfaces:**
- Consumes: the existing marker scheme (`sku LIKE 'DEMO-%'`, `username LIKE 'demo.%'`, `order_no LIKE '1404-9%'`).
- Produces: `seed-demo.mjs` refuses to seed (not to remove) when `NODE_ENV === "production"` or org 1 already holds a non-demo order, unless `--force`. `--remove` covers the new tables.

- [ ] **Step 1: Write `tests/seed-demo-guard.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function freshDb(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-seed-")), "t.db");
  // let lib/db migrations create the schema
  execFileSync("node", ["-e", `process.env.COVERAGE_DB_PATH=${JSON.stringify(p)}; await import("./lib/db.ts").then(m=>m.getDb())`], { stdio: "ignore" });
  return p;
}

describe("seed-demo guard", () => {
  it("refuses to seed a production DB without --force", () => {
    const db = freshDb();
    expect(() =>
      execFileSync("node", ["scripts/seed-demo.mjs"], { env: { ...process.env, COVERAGE_DB_PATH: db, NODE_ENV: "production" }, stdio: "pipe" })
    ).toThrow();
  });

  it("seeds then removes every marked row across the new tables", () => {
    const db = freshDb();
    const env = { ...process.env, COVERAGE_DB_PATH: db, NODE_ENV: "test" };
    execFileSync("node", ["scripts/seed-demo.mjs"], { env, stdio: "pipe" });
    // a demo representative exists
    // (seed-demo creates one with rep_code LIKE 'DEMO-%')
    execFileSync("node", ["scripts/seed-demo.mjs", "--remove"], { env, stdio: "pipe" });
    const left = execFileSync("node", ["-e",
      `process.env.COVERAGE_DB_PATH=${JSON.stringify(db)};` +
      `const {getDb}=await import("./lib/db.ts");const d=getDb();` +
      `const n=d.prepare("SELECT (SELECT COUNT(*) FROM products WHERE sku LIKE 'DEMO-%')+(SELECT COUNT(*) FROM users WHERE username LIKE 'demo.%')+(SELECT COUNT(*) FROM representative_profiles WHERE rep_code LIKE 'DEMO-%') AS n").get().n;` +
      `process.stdout.write(String(n));`
    ], { encoding: "utf8" });
    expect(left.trim()).toBe("0");
  });
});
```

- [ ] **Step 2: Run — verify fail** (guard absent; no demo rep created)

- [ ] **Step 3: Add the production guard to `scripts/seed-demo.mjs`**

Near the top, after `REMOVE` is computed:

```js
const FORCE = process.argv.includes("--force");
if (!REMOVE && !FORCE) {
  if (process.env.NODE_ENV === "production") {
    console.error("[seed-demo] refusing to seed with NODE_ENV=production. Pass --force if you really mean it.");
    process.exit(1);
  }
  const realOrders = db.prepare("SELECT COUNT(*) n FROM orders WHERE order_no NOT LIKE '1404-9%'").get().n;
  if (realOrders > 0) {
    console.error(`[seed-demo] refusing to seed: ${realOrders} real order(s) already exist. Pass --force to override.`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Seed a demo representative + extend `--remove`**

In the seed section, after demo customers/orders are created, add a demo wholesale customer + `representative_profiles` row with `rep_code = 'DEMO-REP-01'` and its onboarding steps (reuse `ONBOARDING_STEPS` shape, or inline). In the `if (REMOVE)` block add, before the `users` delete:

```js
db.exec("DELETE FROM representative_onboarding_steps WHERE representative_id IN (SELECT id FROM representative_profiles WHERE rep_code LIKE 'DEMO-%')");
db.exec("DELETE FROM credit_approvals WHERE order_id IN (SELECT id FROM orders WHERE order_no LIKE '1404-9%')");
db.exec("DELETE FROM representative_profiles WHERE rep_code LIKE 'DEMO-%'");
db.exec("DELETE FROM customers WHERE customer_code LIKE 'DEMO-%'");
```

Give demo customers a `DEMO-` code prefix in the seed section so that last line is precise (check the current seed — if demo customers currently have real-looking codes, prefix them now).

- [ ] **Step 5: Run — verify pass**

- [ ] **Step 6: Full check + commit**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
git add scripts/seed-demo.mjs tests/seed-demo-guard.test.ts
git commit -m "Guard demo seeding against production and cover the new tables in --remove"
```

---

### Task 12: Tenancy wiring — isolation coverage for the new tables

**Files:**
- Modify: `tests/helpers/twoOrgs.ts`
- Modify: `tests/tenancy-schema.test.ts` (confirm exempt list final state)
- Test: `tests/tenancy-isolation.test.ts` already iterates `TENANT_TABLES` — no change needed, but add a targeted rep/credit case.

**Interfaces:**
- Consumes: `seedTwoOrgs` from `tests/helpers/twoOrgs.ts` (extended), `TENANT_TABLES`.
- Produces: `OrgFixture` gains `repId: number` and `creditApprovalId: number`; each org's fixture seeds a `representative_profiles` row (colliding `rep_code = 'SHARED-REP'`) and a `credit_approvals` row.

- [ ] **Step 1: Extend `tests/helpers/twoOrgs.ts`**

Add to `OrgFixture`: `repId: number; creditApprovalId: number;`. In `build(orgId, tag)`, after `orderId`:

```ts
// A representative sharing a rep_code with the other org, to prove per-tenant uniqueness.
const repCustomerId = insert(
  `INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, group_id, organization_id)
   VALUES ('SHARED-REP-CUST', ?, 'WHOLESALE', 'active', ?, ?, ?)`,
  `نماینده ${tag}`, NOW, groupId, orgId
);
const repId = insert(
  `INSERT INTO representative_profiles (organization_id, customer_id, rep_code, stage, credit_terms_days, created_at, updated_at)
   VALUES (?, ?, 'SHARED-REP', 'active', 0, ?, ?)`,
  orgId, repCustomerId, NOW, NOW
);
const creditApprovalId = insert(
  `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status)
   VALUES (?, ?, ?, ?, 1000, 0, 1000, 'pending')`,
  orgId, orderId, managerId, NOW
);
```

Return them in the `OrgFixture`.

- [ ] **Step 2: Run the isolation suite**

Run: `npx vitest run tests/tenancy-isolation.test.ts`
Expected: PASS — the generic "every owner sees only their own rows in every tenant table" test now also covers `representative_profiles` and `credit_approvals` (they are in `TENANT_TABLES`), and the "same natural keys in both orgs" test still holds (`SHARED-REP` in both).

- [ ] **Step 3: Add a targeted assertion**

In `tests/tenancy-isolation.test.ts`, add:

```ts
it("keeps representatives and credit approvals apart", () => {
  const db = getDb();
  for (const [self, other] of [[a, b], [b, a]] as const) {
    const reps = db.prepare("SELECT id FROM representative_profiles WHERE organization_id = ?").all(self.orgId) as { id: number }[];
    expect(reps.map((r) => r.id)).toContain(self.repId);
    expect(reps.map((r) => r.id)).not.toContain(other.repId);
    const ca = db.prepare("SELECT id FROM credit_approvals WHERE organization_id = ?").all(self.orgId) as { id: number }[];
    expect(ca.map((r) => r.id)).not.toContain(other.creditApprovalId);
  }
});
```

- [ ] **Step 4: Confirm `tests/tenancy-schema.test.ts` exempt list**

Final `exempt` set must: NOT contain `import_log`, `import_snapshots` (Task 1); contain `representative_onboarding_steps` (Task 8), `app_meta` (Task 5, if created). `platform_access_log` stays. Run `npx vitest run tests/tenancy-schema.test.ts` — PASS (every table accounted for).

- [ ] **Step 5: Full suite + real-data check**

```bash
npx tsc --noEmit && npx eslint && npx vitest run
python3 - <<'PY'
import sqlite3
src = sqlite3.connect("data/backups/pre-tenancy-20260901-224428.db")
dst = sqlite3.connect("/tmp/claude-0/scratch-0b-final.db"); src.backup(dst); dst.close(); src.close()
PY
ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/claude-0/scratch-0b-final.db npx vitest run tests/tenancy-schema.test.ts tests/customer-lifecycle-migration.test.ts
```
Expected: all green; the migration applies cleanly to real data.

- [ ] **Step 6: Commit + update the handoff**

Update `docs/HANDOFF-2026-09-02-tenancy.md` Phase-0b line to DONE with the final commit range and test count. Update `docs/crm-erp-plan.md` Part 5 — mark Phase 0 "Foundations" complete.

```bash
git add tests/helpers/twoOrgs.ts tests/tenancy-isolation.test.ts docs/
git commit -m "Cover representatives and credit approvals in the two-org isolation suite; Phase 0b done"
```

---

## Self-review notes

- **Spec coverage:** WS1 → Tasks 1–2. WS2 → Task 3. WS3 → Tasks 4–6. WS4 → Tasks 7–9. WS5 → Tasks 10–11. WS6 → Task 12. Every spec section maps to at least one task.
- **Deferred, per spec "out of scope":** the automatic `order → PENDING_CREDIT` trigger (Phase 3), derived debt ageing (Phase 1), rewriting the 314 grandfathered SQL sites (incremental), rep-facing UI / health / academy (Phase 8), `logPlatformAccess` per-endpoint wiring.
- **Type consistency:** `CustomerLifecycle` / `CustomerType` defined in Task 4 (`lib/types.ts`), consumed in Tasks 5–6. `RepStage` defined in Task 8 (`lib/repStages.ts`), consumed in Tasks 8–9. `makeRepo` / `Repo<Row>` defined in Task 3, consumed in Tasks 6, 8, 10. `LifecycleError` / `RepStageError` / `CreditApprovalError` each defined once in their repo module and imported by the matching route.
- **Known soft spots to watch during execution:** (a) Task 4's `customers` rebuild must reproduce every existing index and FK — read `sqlite_master` first. (b) Task 1's `CoverageMap.tsx` edit is in a 2000-line file; use `tsc` to confirm nothing else referenced the removed panel. (c) Task 11's demo-rep seeding must use a `DEMO-` customer code prefix or the `--remove` customer delete is imprecise.
