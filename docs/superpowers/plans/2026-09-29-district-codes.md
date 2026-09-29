# District Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Tehran's geography into the empty `districts` table and give every district a short, stable, speakable code.

**Architecture:** A boot migration makes `districts` shared reference data (no `organization_id`), matching the base `CREATE TABLE` at `lib/db.ts:783` that already has the correct `UNIQUE(name, level, parent_name)`. Seed scripts then load 22 منطقه + 369 محله + 34 بخش + 7 towns, and a separate idempotent pass assigns codes — deliberately after the seeds, so a re-seed can never renumber a printed route sheet.

**Tech Stack:** TypeScript, `node:sqlite` (`DatabaseSync`), Next.js 16, vitest, OSM-derived GeoJSON.

**Spec:** `docs/superpowers/specs/2026-09-29-district-codes-design.md`

---

## Read this first: the four landmines

This plan exists because a review found four defects that a first-pass implementation would have shipped. Each has a task; each has a test.

1. **`INSERT OR IGNORE` does not dedupe today.** In SQLite a NULL never equals another NULL inside a UNIQUE index, and the seeds write `organization_id = NULL` *and* `parent_name = NULL` for the 22 منطقه and 34 بخش. Three seed runs produce three copies. → Tasks 2, 3
2. **A custom district never shadowed a بخش.** `districtIdForPoint` orders `mahalle` before `mantaghe`, but a بخش *is* stored as `level='mantaghe'`, so the tie-break is `id` and a later insert loses. → Task 7
3. **`districts` is wrongly in `TENANT_TABLES`.** Two boot sweeps would re-`ALTER` the column back and stamp `organization_id = 1` on every row. → Task 1
4. **`lib/repo/rules.ts:405` filters districts by `organization_id`.** With the column gone that query throws and district reminders stop silently. → Task 2

## Boot order, because it constrains where edits go

`getDb()` runs in this order. Getting it wrong means editing a table that does not exist yet.

| When | What happens to `districts` |
|---|---|
| `lib/db.ts:762` | base `CREATE TABLE IF NOT EXISTS` — **already correct**: `UNIQUE(name, level, parent_name)`, no `organization_id` |
| `lib/db.ts:2340` | `ALTER` adds `assigned_to` |
| `lib/db.ts:2625` | sweep 1: `ALTER` adds `organization_id` to every `TENANT_TABLES` member, then `UPDATE ... SET organization_id = 1` |
| **`lib/db.ts:2754`** | **`rebuildForTenantUnique` adds the org-scoped UNIQUE back** |
| `lib/db.ts:2832` | `ALTER` adds `group_id` |
| `lib/db.ts:2961` | `ALTER` adds `centroid_lat` / `centroid_lng`, then `backfillDistrictCentroids` |

So the rebuild at 2754 runs *after* sweep 1 and *before* the `group_id` and centroid ALTERs. Removing `districts` from `TENANT_TABLES` stops sweep 1; changing the 2754 call stops the rebuild. Both are required — one alone leaves the other putting the column back.

## Conventions this repo follows

- **Guarded `ALTER TABLE ADD COLUMN`**: check `PRAGMA table_info` membership first (`lib/db.ts:2340`).
- **Table rebuilds** go through `rebuildForTenantUnique` (`lib/db.ts:118`), guarded on `sqlite_master` **text**, never on `app_meta`.
- **`app_meta` markers are near-illegal.** `tests/no-one-shot-data-migration.test.ts` requires every `FROM app_meta WHERE key = '...'` read in `lib/db.ts` to be on its reasoned `MARKER_OK` list. **This plan adds zero `app_meta` reads.**
- **Test DBs** are temp files: set `process.env.ROUTEFLOW_DB_PATH` before `await import("@/lib/db")`, and `rmSync` in `afterAll` (`tests/crm-schema.test.ts:5-7,15-17`).
- **Verify with:** `npx tsc --noEmit` (0 errors) and `npx vitest run tests/<file>`. **Never** `next build` — this machine cannot finish one.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/db.ts` | Remove `districts` from `TENANT_TABLES`; retarget the rebuild at 2754; add `code`/`parent_no` columns |
| `lib/repo/rules.ts` | One query loses its `organization_id` filter (line 405) |
| `lib/districtCodes.ts` | **New.** Pure code-assignment logic: `parentNoFromName`, `codeForMahalle`, `assignCodes`. No DB, no side effects — this is the testable core |
| `lib/groups.ts` | `districtIdForPoint` + `recomputeCustomerGroups` ORDER BY gains `is_custom DESC` |
| `lib/repo/search.ts` | District hits in the search overlay, prefix-matched on code |
| `data/tehran-districts-src/districts.json` | **New.** The 22 منطقه, fetched and committed |
| `scripts/seed-districts.ts` | `parent_name` `null` → `''` for منطقه rows |
| `scripts/seed-bakhsh.ts` | same |
| `scripts/seed-outer-towns.ts` | Fix the شهرستان ری parents (§2.3) |
| `scripts/assign-district-codes.ts` | **New.** Idempotent code pass |
| `scripts/backfill-districts.ts` | **New.** `district_id` on pins/customers, dry-run by default |
| `tests/districts-shared-reference.test.ts` | Landmine 1 + 3 |
| `tests/districtCodes.test.ts` | Code assignment purity, idempotence, zero collisions |
| `tests/district-split-guard.test.ts` | Add-never-split (§2.5) |
| `tests/district-custom-precedence.test.ts` | Landmine 2 |
| `tests/district-coverage.test.ts` | The net is a net |
| `tests/districts-seed.test.ts` | The seed reaches the shapes it claims |

`lib/districtCodes.ts` is split out rather than written into a seed script because the
logic is pure geometry-and-naming with no I/O, and `tests/districtSplit.test.ts` is the
precedent for testing that logic directly (`lib/districtSplit.ts` serves `scripts/split-districts.ts`).

---

## Tasks

### Task 1: Districts become shared reference data

**Fixes landmine 3.** Without this, every later task builds on a schema that two boot sweeps actively undo.

**Files:**
- Modify: `lib/db.ts:50` (remove from `TENANT_TABLES`)
- Modify: `lib/db.ts:2754-2774` (rebuild call)
- Test: `tests/districts-shared-reference.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/districts-shared-reference.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-districts-shared-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = (t: string) => (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const schema = (t: string) =>
  (getDb().prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) as { sql: string }).sql;

describe("districts are shared reference data, not tenant data", () => {
  it("is not a tenant table", () => {
    expect((TENANT_TABLES as readonly string[]).includes("districts")).toBe(false);
  });

  it("has no organization_id column after boot", () => {
    expect(cols("districts")).not.toContain("organization_id");
  });

  it("keeps the plain natural key", () => {
    expect(schema("districts")).toContain("UNIQUE(name, level, parent_name)");
    expect(schema("districts")).not.toContain("organization_id");
  });

  it("keeps every other district column the code and geometry depend on", () => {
    expect(cols("districts")).toEqual(expect.arrayContaining([
      "id", "name", "level", "parent_name", "boundary_geojson",
      "coverage_status", "notes", "is_custom", "updated_at",
      "assigned_to", "centroid_lat", "centroid_lng", "group_id",
    ]));
  });

  // The seed-dedupe landmine. See spec 2.6 Bug B.
  it("actually dedupes: three identical inserts leave one row", () => {
    const db = getDb();
    const geo = JSON.stringify({
      type: "Polygon",
      coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]],
    });
    const ins = db.prepare(
      `INSERT OR IGNORE INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
       VALUES (?, ?, ?, ?, 'unknown', 0, ?)`
    );
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) ins.run("منطقه 14", "mantaghe", "", geo, now);
    const n = (db.prepare("SELECT COUNT(*) c FROM districts WHERE name = ?").get("منطقه 14") as { c: number }).c;
    expect(n, "parent_name='' must dedupe; NULL would not").toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/districts-shared-reference.test.ts`
Expected: FAIL on all four. `districts` is in `TENANT_TABLES`, `organization_id` is present, the schema carries the org-scoped key, and the dedupe test yields `n = 3`.

- [ ] **Step 3: Remove districts from TENANT_TABLES**

In `lib/db.ts`, delete line 50:

```ts
export const TENANT_TABLES = [
  "groups",
  "customers",
  "districts",      // ← delete this line
  "facilities",
```

This is what stops `lib/db.ts:2625` and `:3471` from re-`ALTER`ing the column back and stamping `organization_id = 1` on every row every boot.

- [ ] **Step 4: Retarget the rebuild so it restores the plain key**

`rebuildForTenantUnique` guards on the *new* constraint text and only fires when that text is absent. So the marker must be the plain key, and the `createSql` must produce the plain key.

Replace the `lib/db.ts:2754-2774` call with:

```ts
  // districts is SHARED reference data, not tenant data: Tehran's 22 منطقه are the same
  // for every organisation, and per-tenant copies would be duplicated geometry free to
  // drift apart until منطقه 14 meant two different places. The base CREATE at the top of
  // getDb() already declares the plain key; this rebuild is what brings a database
  // created before that decision back to it.
  //
  // Removing "districts" from TENANT_TABLES (above) is what stops the sweeps from
  // re-ALTERing the column back. Both edits are required -- either alone leaves the
  // other restoring organization_id on the next boot.
  rebuildForTenantUnique(
    db,
    "districts",
    "UNIQUE(name, level, parent_name)",
    `CREATE TABLE districts_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('mantaghe', 'mahalle')),
      parent_name TEXT,
      boundary_geojson TEXT NOT NULL,
      coverage_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (coverage_status IN ('visited', 'needs_coverage', 'not_allowed', 'unknown')),
      notes TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      assigned_to TEXT,
      centroid_lat REAL,
      centroid_lng REAL,
      group_id INTEGER REFERENCES groups(id)
    );`
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/districts-shared-reference.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 6: Prove the rebuild did not lose data on a populated database**

The helper's `INSERT ... SELECT` copies columns **by name** from `PRAGMA table_info`, so a rebuild that drops a column cannot use the generic path. The call above drops `organization_id`, so verify the copy explicitly against a database that has rows.

Run:

```bash
node -e "
const fs=require('fs');
fs.copyFileSync('data/routeflow.db','/tmp/populated.db');
fs.copyFileSync('data/routeflow.db-wal','/tmp/populated.db-wal');
fs.copyFileSync('data/routeflow.db-shm','/tmp/populated.db-shm');
"
ROUTEFLOW_DB_PATH=/tmp/populated.db node --experimental-strip-types -e "
import { getDb } from './lib/db.ts';
const db = getDb();
const c = (t) => db.prepare('SELECT COUNT(*) n FROM '+t).get().n;
console.log('districts rows:', c('districts'));
console.log('customers rows:', c('customers'));
console.log('columns:', db.prepare('PRAGMA table_info(districts)').all().map(x=>x.name).join(','));
"
```

Expected: `customers rows: 16` (unchanged). If `customers` drops, **stop** — the rebuild cascaded and the FK suspension did not hold.

- [ ] **Step 7: Fix the one org-filtered district query**

`lib/repo/rules.ts:405` reads:

```ts
        : db.prepare("SELECT 1 FROM districts WHERE id = ? AND organization_id = ?").get(r.entity_id, organizationId);
```

A district is shared, so the org filter is not merely broken by the dropped column — it was **wrong**. Every org's reminder should fire on a shared district. Replace the whole `inOrg` expression with:

```ts
    // districts is shared reference data (see spec §2.6), so a district reminder belongs
    // to every organisation and the check is existence, not membership. Filtering by
    // organization_id here would suppress every district reminder on the install, and
    // the column it filtered on no longer exists.
    const inOrg =
      r.entity_type === "customer"
        ? !!db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(r.entity_id, organizationId)
        : !!db.prepare("SELECT 1 FROM districts WHERE id = ?").get(r.entity_id);
```

Note the `!!` — `.get()` returns `undefined` on no match, and the original relied on truthiness, so this preserves it.

- [ ] **Step 8: Verify nothing else reads districts by org**

Run: `grep -rn "districts" --include=*.ts lib app | grep organization_id`
Expected: no output. If anything appears, it needs the same treatment.

- [ ] **Step 9: Run the guard tests that must not regress**

Run: `npx vitest run tests/no-one-shot-data-migration.test.ts tests/tenancy-schema.test.ts tests/no-cascade-migration.test.ts`
Expected: PASS. The first guards `app_meta` usage; this task adds none.

- [ ] **Step 10: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
git add lib/db.ts lib/repo/rules.ts tests/districts-shared-reference.test.ts
git commit -m "fix(db): districts is shared reference data, not tenant data

Tehran's 22 mantaghe are the same for every organisation. Per-tenant copies
would be duplicated geometry free to drift apart until منطقه 14 meant two
different places, so districts comes out of TENANT_TABLES and the boot
rebuild restores the plain natural key the base CREATE already declares.

Both edits are required. Removing districts from TENANT_TABLES stops the two
sweeps re-ALTERing organization_id back and stamping it to 1; retargeting
the rebuild stops it re-adding the org-scoped key. Either alone leaves the
other undoing it on the next boot.

The rebuild drops a column, so its INSERT..SELECT copies by name from
PRAGMA table_info and cannot use the generic path unchanged -- verified
against a populated copy that customers survives at 16 rows.

rules.ts:405 filtered district reminders by organization_id, which was wrong
independently of the column: a shared district belongs to every org, so the
check is existence. Left alone it would have thrown on every district
reminder and silenced them all."
```

---

### Task 2: Fetch the 22 منطقه

**Without this, `seed-districts.ts` still dies at line 59 and `districts` stays empty.**

**Files:**
- Create: `data/tehran-districts-src/districts.json`

- [ ] **Step 1: Create the directory and fetch the file**

`scripts/seed-districts.ts:58-60` reads exactly this path, so no script edit is needed for the path itself.

```bash
mkdir -p data/tehran-districts-src
curl -sL -o data/tehran-districts-src/districts.json \
  https://raw.githubusercontent.com/mjalalimanesh/tehran-districts-neighborhoods-map-geojson/main/tehran_districts_22.geojson
```

- [ ] **Step 2: Verify it is the right file, not a truncated download**

```bash
node -e "
const d=require('./data/tehran-districts-src/districts.json');
console.log('type:', d.type);
console.log('features:', d.features.length);
const nums=d.features.map(f=>{
  const FA={'۰':0,'۱':1,'۲':2,'۳':3,'۴':4,'۵':5,'۶':6,'۷':7,'۸':8,'۹':9};
  const m=(f.properties.name||'').replace(/[۰-۹]/g,c=>FA[c]).match(/(\d+)/);
  return m?Number(m[1]):null;
});
console.log('parsed parent_no:', nums.filter(n=>n!==null).length, 'of', nums.length);
console.log('distinct:', new Set(nums).size);
"
```

Expected: `FeatureCollection`, `features: 22`, `parsed parent_no: 22 of 22`, `distinct: 22`.

If `features` is not 22, the download failed — re-run Step 1. Do not proceed on a partial file; the seeder would load a partial hierarchy.

- [ ] **Step 3: Verify compatibility with our 369 محله before trusting it**

```bash
node -e "
const fs=require('fs');
const m22=JSON.parse(fs.readFileSync('data/tehran-districts-src/districts.json','utf8'));
const mah=JSON.parse(fs.readFileSync('data/mahalle.geojson','utf8'));
function outer(g){if(!g)return[];if(g.type==='Polygon')return[g.coordinates[0]];if(g.type==='MultiPolygon')return g.coordinates.map(p=>p[0]);return[]}
function inRing(pt,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi))c=!c}return c}
let inM=0, out=[];
for(const f of mah.features){
  const rs=outer(f.geometry); if(!rs.length) continue;
  const pt=rs[0][0];
  if(m22.features.some(t=>outer(t.geometry).some(r=>inRing(pt,r)))) inM++; else out.push(f.properties.name);
}
console.log('mahalle inside a mantaghe:', inM, 'of', mah.features.length);
console.log('outside:', out.join(', ') || '(none)');
"
```

Expected: `367 of 369`, outside = `شهرک رضویه, شهید بهشتی`. Those two are handled in Task 4.

- [ ] **Step 4: Commit the data file**

```bash
git add data/tehran-districts-src/districts.json
git commit -m "data(districts): the 22 Tehran mantaghe polygons

seed-districts.ts:59 reads data/tehran-districts-src/districts.json and
that path did not exist, so the script died with ENOENT at line 59 --
before it could load the 369 mahalle either. That is why districts had 0
rows: not a decision, a missing file.

Sourced from map.tehran.ir via mjalalimanesh/tehran-districts-neighborhoods-
map-geojson. sadegh-khan/tehran-map-geojson holds a byte-identical copy
(md5 67ba2362ff1c7228bc2ce8f1dd927372), so this is not a one-person
hand-drawn file.

Verified against our own data: 367 of the 369 mahalle in mahalle.geojson
fall inside one of these 22. The two that do not -- شهرک رضویه and
شهید بهشتی -- sit just outside the outline and are handled in the seed."
```

---

### Task 3: Make the seeds actually dedupe

**Fixes landmine 1.** Every seed script carries the comment *"Safe to re-run: INSERT OR IGNORE, never overwrites a status a user already set."* That comment is false today, and the plan's Step 2 test proves it.

**Files:**
- Modify: `scripts/seed-districts.ts:61-65` (منطقه parent), `:76-77` (insert)
- Modify: `scripts/seed-bakhsh.ts:20-21`
- Modify: `scripts/seed-outer-towns.ts:11-14`, `:22-23`
- Test: `tests/districts-seed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/districts-seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** The seed data files must exist and be complete BEFORE any seed script runs.
 *
 *  scripts/seed-districts.ts:59 died with ENOENT for the whole life of this repo
 *  because data/tehran-districts-src/districts.json was missing -- and it died before
 *  line 67, so the 369 mahalle never loaded either. districts sat empty and nothing said
 *  why. This test is the tripwire for that class of failure: a missing or truncated
 *  source file fails here, by name, instead of leaving an empty table. */
const DATA = (f: string) => path.join(process.cwd(), "data", f);

describe("district seed sources", () => {
  it("has the 22 mantaghe file seed-districts.ts reads", () => {
    const p = DATA(path.join("tehran-districts-src", "districts.json"));
    expect(fs.existsSync(p), `${p} is missing -- seed-districts.ts:59 will throw ENOENT`).toBe(true);
    const gj = JSON.parse(fs.readFileSync(p, "utf8")) as { type: string; features: unknown[] };
    expect(gj.type).toBe("FeatureCollection");
    expect(gj.features.length).toBe(22);
  });

  it("has the 369 mahalle, each naming its mantaghe", () => {
    const m = JSON.parse(fs.readFileSync(DATA("mahalle.geojson"), "utf8")) as {
      features: { properties: { name?: string; mantaghe?: string } }[];
    };
    expect(m.features.length).toBeGreaterThanOrEqual(369);
    const named = m.features.filter((f) => f.properties.name && f.properties.mantaghe);
    expect(named.length, "every mahalle needs a name and a parent").toBe(m.features.length);
  });

  it("has the 34 bakhsh and the 7 outer towns", () => {
    expect((JSON.parse(fs.readFileSync(DATA("bakhsh-districts.json"), "utf8")) as unknown[]).length).toBe(34);
    expect((JSON.parse(fs.readFileSync(DATA("outer-towns.json"), "utf8")) as unknown[]).length).toBe(7);
  });

  it("uses '' not null for a top-level parent, or INSERT OR IGNORE cannot dedupe", () => {
    for (const f of ["seed-districts.ts", "seed-bakhsh.ts", "seed-outer-towns.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", f), "utf8");
      expect(src, `${f} must not pass a literal NULL parent_name`).not.toMatch(/,\s*NULL,\s*\?/);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm the dedupe assertion fails**

Run: `npx vitest run tests/districts-seed.test.ts`
Expected: the three "has the …" tests PASS (the data is on disk), and the `'' not null` test **FAILS** — `seed-districts.ts` and `seed-bakhsh.ts` both pass `NULL` as the parent.

That failure is the landmine, visible.

- [ ] **Step 3: seed-districts.ts — stop writing a NULL parent for منطقه**

At `scripts/seed-districts.ts:61-65`:

```ts
for (const f of mantagheGeo.features) {
  const name = f.properties?.name;
  if (!name) continue;
  // '' and not null: UNIQUE(name, level, parent_name) treats every NULL as distinct from
  // every other NULL, so a NULL parent makes INSERT OR IGNORE insert a fresh copy on
  // every run. '' compares equal to '', so the guard finally does what the comment
  // above this script has always claimed it does.
  addFeature(name, "mantaghe", "", f.geometry);
}
```

- [ ] **Step 4: seed-bakhsh.ts — same, in the SQL literal**

At `scripts/seed-bakhsh.ts:19-22`:

```ts
const insert = db.prepare(`
  INSERT OR IGNORE INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
  VALUES (?, 'mantaghe', '', ?, 'unknown', 0, ?)
`);
```

The old value was the literal `NULL` in the VALUES list. It becomes `''`.

- [ ] **Step 5: seed-outer-towns.ts — fix the wrong parents AND the dedupe**

At `scripts/seed-outer-towns.ts:11-14`, replace the constant. Three of the seven towns are in شهرستان ری, not دماوند — verified by testing each centroid against the بخش polygons:

```ts
// Checked by casting each town's centroid against the bakhsh polygons in
// data/bakhsh-districts.json: bomehen, abali and rudehen are all in شهرستان ری
// (bomehen in بخش بومهن, the other two in بخش رودهن). The old DEFAULT_PARENT filed
// all three under دماوند, which is roughly 40km away.
const PARENT_COUNTY: Record<string, string> = {
  پردیس: "شهرستان پردیس",
  بومهن: "شهرستان ری",
  آبعلی: "شهرستان ری",
  رودهن: "شهرستان ری",
  دماوند: "شهرستان دماوند",
  آبسرد: "شهرستان دماوند",
  کیلان: "شهرستان دماوند",
};
const DEFAULT_PARENT = "شهرستان دماوند";
```

`DEFAULT_PARENT` stays as the fallback for a town added to the JSON later, and the map now covers all seven so nothing falls through.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/districts-seed.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 7: Run the seeds for real, and check the counts**

```bash
node --experimental-strip-types scripts/seed-districts.ts
node --experimental-strip-types scripts/seed-bakhsh.ts
node --experimental-strip-types scripts/seed-outer-towns.ts
```

Expected: `22 + 369`, `34`, `7`, then a total of **432**.

- [ ] **Step 8: Prove the re-run is now genuinely safe — the whole point of Task 3**

```bash
node --experimental-strip-types scripts/seed-districts.ts
node --experimental-strip-types scripts/seed-districts.ts
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
console.log('districts rows:', db.prepare('SELECT COUNT(*) n FROM districts').get().n);
console.log('by level:', JSON.stringify(db.prepare('SELECT level, COUNT(*) n FROM districts GROUP BY level').all()));
console.log('distinct names:', db.prepare('SELECT COUNT(DISTINCT name) n FROM districts').get().n);
"
```

Expected: still **432**, not 854. A count above 432 means the NULL trap is not fixed — stop and re-check Steps 3–4.

- [ ] **Step 9: Confirm the outer towns are parented correctly**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
for (const r of db.prepare(\"SELECT name, parent_name FROM districts WHERE name IN ('بومهن','آبعلی','رودهن','پردیس') ORDER BY name\").all())
  console.log(r.name, '->', r.parent_name);
"
```

Expected: بومهن/آبعلی/رودهن → `شهرستان ری`; پردیس → `شهرستان پردیس`.

- [ ] **Step 10: Commit**

```bash
git add scripts/seed-districts.ts scripts/seed-bakhsh.ts scripts/seed-outer-towns.ts tests/districts-seed.test.ts
git commit -m "fix(seed): make INSERT OR IGNORE actually ignore

All three seed scripts say 'safe to re-run' in their own comments. They
were not. UNIQUE(name, level, parent_name) treats every NULL as distinct
from every other NULL, and the 22 mantaghe and 34 bakhsh were both seeded
with a NULL parent -- so a second run appended a second copy of every row
rather than ignoring it. Measured on the real statement: three runs, three
rows. Seeding the mantaghe parent as '' instead of null is the entire fix;
'' compares equal to ''.

Also fixes the parents three outer towns were given. bomehen, abali and
rudehen were all filed under شهرستان دماوند, roughly 40km from where they
are -- they are in شهرستان ری, which is what checking each centroid
against the bakhsh polygons shows. The other four were already right.

tests/districts-seed.test.ts now asserts the source files exist before
anything runs, since a missing one is what emptied this table in the first
place."
```

---

### Task 4: Split the same-name districts, before anything points at them

**Order matters:** this runs at seed time, against a table no customer has ever pointed at. Afterwards it is forbidden (spec §2.5) and Task 8 makes that mechanical.

**Files:**
- Run: `scripts/split-districts.ts`
- Test: `tests/district-split-guard.test.ts`

- [ ] **Step 1: Dry-run first — the script has a dry-run default**

```bash
node --experimental-strip-types scripts/split-districts.ts
```

Expected: prints which districts it *would* split and changes nothing. The 13 same-name cases (کوهسار in منطقه 4 is drawn 21km apart, پونک جنوبی, صادقیه, قیام, …) should appear here.

- [ ] **Step 2: Confirm nothing is referenced yet**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
console.log('customers with a district:', db.prepare('SELECT COUNT(*) n FROM customers WHERE district_id IS NOT NULL').get().n);
console.log('pins with a district:', db.prepare('SELECT COUNT(*) n FROM saved_locations WHERE district_id IS NOT NULL').get().n);
"
```

Expected: **0 and 0**. Task 6 sets these, and it runs *after* this task. If either is non-zero, stop — a populated split is the bug this ordering prevents.

- [ ] **Step 3: Apply**

```bash
node --experimental-strip-types scripts/split-districts.ts --apply
```

- [ ] **Step 4: Verify**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
console.log('districts rows now:', db.prepare('SELECT COUNT(*) n FROM districts').get().n);
console.log('split names:', JSON.stringify(db.prepare(\"SELECT name FROM districts WHERE name LIKE '%(%' ORDER BY name\").all()));
"
```

Expected: more than 432, with `کوهسار (غرب)`-style names present.

- [ ] **Step 5: Write the split-guard test**

Create `tests/district-split-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Add, never split. Spec §2.5.
 *
 *  customers.district_id is a plain INTEGER foreign key. split-districts.ts gives the
 *  largest piece the original row id and the new piece a fresh one -- and moves no
 *  customer to it. Every customer in a split محله would keep pointing at the piece that
 *  kept the id even when they are geographically in the other half, and nothing
 *  re-derives them until someone edits that customer.
 *
 *  Same class of bug as the pin fold deleting a run stop mid-run (a98ae50) and the
 *  fourth FK referrer (d523fe3): a migration that changes ids under live references. */
const ROOT = process.cwd();

describe("a district with customers is never split", () => {
  it("split-districts.ts refuses a district that customers point at", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "split-districts.ts"), "utf8");
    // It must count referencing customers before it splits.
    expect(src, "the split must count customers first").toMatch(/district_id/);
    expect(src, "and refuse when the count is non-zero").toMatch(/throw|refuse|skipp?ing/i);
  });

  it("split-districts.ts is never invoked from a boot migration", () => {
    const db = fs.readFileSync(path.join(ROOT, "lib", "db.ts"), "utf8");
    expect(db, "splitting is a manual seed-time step, not a boot migration").not.toMatch(/split-districts/);
    const rules = fs.readFileSync(path.join(ROOT, "lib", "repo", "rules.ts"), "utf8");
    expect(rules).not.toMatch(/split-districts/);
  });

  it("the seed-time split still works against an empty customers table", () => {
    // The distinction that matters: before any customer exists, splitting is fine and
    // planSplit's output is what gives the two halves their own codes (spec §3.2).
    const src = fs.readFileSync(path.join(ROOT, "scripts", "split-districts.ts"), "utf8");
    expect(src).toContain("--apply");
    expect(src).toMatch(/dry-run|changes nothing/i);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run tests/district-split-guard.test.ts`
Expected: the second and third pass immediately; the **first fails**, because `split-districts.ts` has no guard today.

- [ ] **Step 7: Add the guard**

In `scripts/split-districts.ts`, after the `db.exec` that opens the connection and before the row loop, insert:

```ts
// Add, never split (spec §2.5). A split gives the largest piece the original row id and
// the new piece a fresh one, and moves no customer with it -- so every customer in a
// split محله would silently keep the old classification even when they are in the other
// half. Before a split is a data-integrity no-op; after one, it is a corruption. Refuse.
const customersPerDistrict = new Map<number, number>(
  (db
    .prepare("SELECT district_id, COUNT(*) n FROM customers WHERE district_id IS NOT NULL GROUP BY district_id")
    .all() as unknown as { district_id: number; n: number }[]).map((r) => [r.district_id, r.n])
);
```

Then inside the `if (apply)` block, before the transaction:

```ts
    if (apply) {
      const referencing = customersPerDistrict.get(row.id) ?? 0;
      if (referencing > 0) {
        console.log(
          `   SKIPPED: ${row.name} (id ${row.id}) has ${referencing} customer(s). ` +
            `Splitting would leave them pointing at the wrong half -- add a new district instead.`
        );
        continue;
      }
    }
```

- [ ] **Step 8: Verify the guard fires, using a real customer**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db');
const d=db.prepare('SELECT id,name FROM districts WHERE name LIKE ? LIMIT 1').get('%روشن%') || db.prepare('SELECT id,name FROM districts LIMIT 1').get();
db.prepare('UPDATE customers SET district_id = ? WHERE id = (SELECT MIN(id) FROM customers)').run(d.id);
console.log('pinned customer to', d.name, '(id', d.id + ')');
db.close();
"
node --experimental-strip-types scripts/split-districts.ts --apply 2>&1 | grep -i "skipped" || echo "no skip reported"
```

Expected: a `SKIPPED` line naming the district and the customer count. Then undo the test change:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db');
db.prepare('UPDATE customers SET district_id = NULL WHERE district_id IS NOT NULL').run();
console.log('cleared test district_id');
db.close();
"
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/district-split-guard.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 10: Commit**

```bash
git add scripts/split-districts.ts tests/district-split-guard.test.ts
git commit -m "fix(districts): refuse to split a district that has customers

district_id is a plain INTEGER foreign key. split-districts.ts gives the
largest piece the original row id and the new piece a fresh one, and moves
no customer with it -- so every customer in a split محله keeps the old
classification even when they are geographically in the other half, and
nothing re-derives them until someone edits that customer.

Before the seed it is a no-op. After one it is corruption, and the same
shape as the pin fold deleting a run stop mid-run (a98ae50) and the fourth
FK referrer (d523fe3). So it counts referencing customers first and skips
with a message naming the count. The 13 same-name cases still split, because
this runs before Task 6 points anything at a district.

The alternative -- add a child district -- is why is_custom exists."
```

---

### Task 5: The code-assignment core

**The one piece of genuinely new logic.** Kept in its own file because it is pure — no DB, no I/O — and `lib/districtSplit.ts` (serving `scripts/split-districts.ts`) is the precedent for testing that shape directly.

**Files:**
- Create: `lib/districtCodes.ts`
- Test: `tests/districtCodes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/districtCodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parentNoFromName, codeForMantaghe, mahalleCode, orderedMahalle, CODES } from "@/lib/districtCodes";

/** Codes are pure functions of geometry and naming, which is what makes them testable
 *  without a database and re-runnable without renumbering anything. */

describe("parentNoFromName", () => {
  it("reads Persian digits", () => {
    expect(parentNoFromName("منطقه ۱۴ شهر تهران")).toBe(14);
  });
  it("reads ASCII digits", () => {
    expect(parentNoFromName("منطقه 14")).toBe(14);
  });
  it("reads Arabic-Indic digits", () => {
    expect(parentNoFromName("منطقه ١٤")).toBe(14);
  });
  it("is null when there is no number", () => {
    expect(parentNoFromName("پردیس")).toBeNull();
  });
  // The reason parent_no exists as an INTEGER rather than joining on the name string:
  // the source file and our own file spell the same district two different ways.
  it("collapses both spellings to the same number", () => {
    expect(parentNoFromName("منطقه ۱۴ شهر تهران")).toBe(parentNoFromName("منطقه 14"));
  });
});

describe("codeForMantaghe", () => {
  it("uses Tehran's own number, so a rep can say it", () => {
    expect(codeForMantaghe(14)).toBe("14");
  });
  it("gives letters to the 7 outer towns, which have no number", () => {
    // Digits would collide with منطقه 1..22 in one namespace.
    expect(codeForMantaghe(null, "پردیس", 1)).toBe("P1");
    expect(codeForMantaghe(null, "بومهن", 2)).toBe("B1");
    expect(codeForMantaghe(null, "رودهن", 3)).toBe("R1");
  });
  it("gives a bakhsh a county letter plus B", () => {
    expect(codeForMantaghe(null, "بخش رودهن", 1)).toBe("RB1");
  });
  it("never gives a town a digit-only code", () => {
    for (const [name, i] of [["پردیس", 1], ["بومهن", 2], ["دماوند", 3]] as const) {
      expect(codeForMantaghe(null, name, i)).toMatch(/^[A-Z]/);
    }
  });
});

describe("mahalleCode", () => {
  it("is the parent number plus a two-digit ordinal", () => {
    expect(mahalleCode(14, 1)).toBe("1401");
    expect(mahalleCode(14, 26)).toBe("1426");
  });
  it("zero-pads to keep the width stable for sorting", () => {
    expect(mahalleCode(5, 1)).toBe("501");
    expect(mahalleCode(5, 1).length).toBe(mahalleCode(5, 17).length);
  });
});

describe("orderedMahalle", () => {
  // West to east. This is the property the first proposal got wrong: sorting
  // alphabetically matched geographic order 2/25 and 0/27 in the two districts
  // measured, which would have sent a rep across the city for nothing.
  it("orders by longitude, ascending", () => {
    const rows = [
      { name: "east", lng: 51.9, lat: 35.8 },
      { name: "west", lng: 51.4, lat: 35.8 },
      { name: "middle", lng: 51.6, lat: 35.75 },
    ];
    expect(orderedMahalle(rows).map((r) => r.name)).toEqual(["west", "middle", "east"]);
  });
  it("breaks a longitude tie by latitude so the order is total", () => {
    const rows = [
      { name: "north", lng: 51.5, lat: 35.9 },
      { name: "south", lng: 51.5, lat: 35.7 },
    ];
    expect(orderedMahalle(rows).map((r) => r.name)).toEqual(["south", "north"]);
  });
  it("is stable under input order", () => {
    const a = [{ name: "b", lng: 51.5, lat: 35.7 }, { name: "a", lng: 51.4, lat: 35.7 }];
    expect(orderedMahalle(a).map((r) => r.name)).toEqual(["a", "b"]);
    expect(orderedMahalle([...a].reverse()).map((r) => r.name)).toEqual(["a", "b"]);
  });
  it("does not mutate its input", () => {
    const rows = [{ name: "east", lng: 51.9, lat: 35.8 }, { name: "west", lng: 51.4, lat: 35.8 }];
    orderedMahalle(rows);
    expect(rows.map((r) => r.name)).toEqual(["east", "west"]);
  });
});

describe("CODES", () => {
  it("is empty until a task fills it -- no hardcoded geography in the library", () => {
    // The spec forbids hardcoding geography into application logic (origin brief, Part 6).
    // Codes are derived from the database at seed time, never listed here.
    expect(Object.keys(CODES).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/districtCodes.test.ts`
Expected: FAIL — `Cannot find module '@/lib/districtCodes'`.

- [ ] **Step 3: Create `lib/districtCodes.ts`**

```ts
/** How a district gets its short code, as pure functions.
 *
 *  Separate from the seed script because none of this touches a database: it is
 *  naming and geometry, so it can be tested directly (tests/districtCodes.test.ts) the
 *  way lib/districtSplit.ts is. The same split as lib/searchModel.ts, whose comment
 *  says why: the module decides, the script does.
 *
 *  A code exists to disambiguate two places that share a name, not to encode the
 *  hierarchy. A rep says "پردیس", not "P-one" -- so the name is the interface and the
 *  code is the tiebreaker and the print artifact. Thirteen محله names collide inside
 *  their own منطقه (کوهسار is drawn 21km apart), and that is the case a number earns
 *  its keep. */

/** Persian ۰-۹ and Arabic-Indic ٠-٩. Both spellings reach us: map.tehran.ir writes
 *  "منطقه ۱۴ شهر تهران" and our own mahalle.geojson writes "منطقه 14". */
const DIGIT_FA = "۰۱۲۳۴۵۶۷۸۹";
const DIGIT_AR = "٠١٢٣٤٥٦٧٨٩";

function toAsciiDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const fa = DIGIT_FA.indexOf(ch);
    if (fa >= 0) { out += String(fa); continue; }
    const ar = DIGIT_AR.indexOf(ch);
    if (ar >= 0) { out += String(ar); continue; }
    out += ch;
  }
  return out;
}

/** The number inside a منطقه's name, whichever digits it is written in.
 *
 *  This is the whole reason the schema carries `parent_no INTEGER` rather than joining
 *  the 369 محله to their 22 منطقه on `parent_name`: the two files spell the same
 *  district differently, and an integer cannot be spelled two ways. Returns null for a
 *  name that carries no number -- an outer town, or a بخش. */
export function parentNoFromName(name: string): number | null {
  const m = toAsciiDigits(name).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

const TOWN_INITIAL: Record<string, string> = {
  پردیس: "P", بومهن: "B", رودهن: "R", دماوند: "D", آبسرد: "A", کیلان: "K",
};

/** A منطقه's own code.
 *
 *  Tehran's 22 districts are already numbered, so the code IS that number -- a rep can
 *  say "منطقه 14" out loud and it is unambiguous, which is the only property that
 *  matters for a code someone has to relay by voice.
 *
 *  Outer towns and بخش have no number, and giving them digits would collide with
 *  منطقه 1..22 in one namespace -- the exact confusion a code exists to prevent. So they
 *  get a letter. A town takes its own initial (پردیس -> P1); a بخش takes a county
 *  letter plus "B" (بخش رودهن, in ری -> RB1). */
export function codeForMantaghe(parentNo: number | null, name: string, index = 1): string {
  if (parentNo !== null) return String(parentNo);
  const clean = name.replace(/^بخش\s+/, "").trim();
  if (name.startsWith("بخش")) {
    const county = (name.match(/شهرستان\s+(.+)$/) ?? [])[1];
    const letter = county ? (TOWN_INITIAL[county.trim()] ?? "X") : "X";
    return `${letter}B${index}`;
  }
  const initial = TOWN_INITIAL[clean] ?? "X";
  return `${initial}${index}`;
}

/** A محله's code: the parent's number plus a zero-padded ordinal within it. */
export function mahalleCode(parentNo: number, ordinal: number): string {
  return `${parentNo}${String(ordinal).padStart(2, "0")}`;
}

export interface Placeish {
  name: string;
  lng: number;
  lat: number;
}

/** West to east, latitude breaking a tie.
 *
 *  The ordinal is geographic, not alphabetical. Alphabetical order matched
 *  west-to-east in 2 of 25 محله in منطقه 14 and 0 of 27 in منطقه 5 -- so sorting a
 *  route sheet by an alphabetical ordinal walks across the city in Persian-alphabet
 *  jumps. A code that looks like it encodes a drive order but doesn't is worse than no
 *  code, because a rep trusts it and drives an hour for nothing.
 *
 *  Longitude rather than distance-from-origin: the districts are ~10-30km across, and a
 *  straight line of longitude is a stable west-to-east walk that does not move when the
 *  route's start point does. */
export function orderedMahalle<T extends Placeish>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
}

/** Deliberately empty. Geography lives in `districts`; the library derives codes from
 *  it and never lists a place itself, so no name here can go stale against the seed. */
export const CODES: Record<string, string> = {};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/districtCodes.test.ts`
Expected: PASS, 17/17.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/districtCodes.ts tests/districtCodes.test.ts
git commit -m "feat(districts): the code rules, as pure functions

No database, no I/O -- naming and geometry only, so it is tested directly
the way lib/districtSplit.ts is. The seed script does; this decides.

A code exists to disambiguate two places that share a name, not to encode
the hierarchy: a rep says پردیس, not P-one. Thirteen محله names collide
inside their own منطقه -- کوهسار is drawn 21km apart -- and that is the
case a number earns its keep.

Tehran's 22 districts are already numbered, so the code is that number.
Outer towns and بخش have none, and digits would collide with منطقه 1..22 in
one namespace, so they get a letter: a town its own initial (پردیس -> P1), a
بakhsh a county letter plus B (بخش رودهن -> RB1).

The محله ordinal is west-to-east, not alphabetical. Measured, alphabetical
order matched geographic order 2/25 in منطقه 14 and 0/27 in منطقه 5, so an
alphabetical route sheet walks across the city in Persian-alphabet jumps.
A code that looks like it encodes a drive order but doesn't is worse than
no code.

parentNoFromName is why parent_no is an INTEGER: map.tehran.ir writes
منطقه ۱۴ and our own file writes منطقه 14, and an integer cannot be spelled
two ways."
```

---

### Task 6: Add `code` / `parent_no` and assign them

**Separate from the seeds on purpose (spec §2.7).** If codes were assigned during seeding, a re-seed after a split would renumber existing districts and every printed route sheet would silently point somewhere else.

**Files:**
- Modify: `lib/db.ts` (guarded ALTER, near the other `districts` ALTERs)
- Create: `scripts/assign-district-codes.ts`
- Test: `tests/district-code-uniqueness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/district-code-uniqueness.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-district-code-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = (t: string) => (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

const geo = JSON.stringify({
  type: "Polygon",
  coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]],
});

describe("districts code columns", () => {
  it("adds code and parent_no", () => {
    expect(cols("districts")).toEqual(expect.arrayContaining(["code", "parent_no"]));
  });

  // Partial-unique, because a hand-drawn district has no code until an operator assigns
  // one. A hard UNIQUE would fail the moment two customs were left blank.
  it("lets two uncoded districts coexist", () => {
    const db = getDb();
    const ins = db.prepare(
      `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
       VALUES (?, 'mantaghe', '', ?, 'unknown', 1, ?)`
    );
    const now = new Date().toISOString();
    ins.run("custom a", geo, now);
    ins.run("custom b", geo, now);
    const n = (db.prepare("SELECT COUNT(*) c FROM districts WHERE code IS NULL").get() as { c: number }).c;
    expect(n).toBe(2);
  });

  it("rejects two districts claiming the same code", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at) VALUES ('a','mantaghe','',?, 'P1','unknown',1,?)").run(geo, now);
    expect(() =>
      db.prepare("INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at) VALUES ('b','mantaghe','',?, 'P1','unknown',1,?)").run(geo, now)
    ).toThrow();
  });

  it("indexes code so the search prefix query is not a table scan", () => {
    const rows = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'districts'")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("ix_districts_code");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/district-code-uniqueness.test.ts`
Expected: FAIL — `code` and `parent_no` do not exist.

- [ ] **Step 3: Add the guarded ALTERs**

In `lib/db.ts`, immediately after the centroid ALTER block (`:2961-2965`, which ends with `backfillDistrictCentroids(db);`), add:

```ts
  // A short, speakable code per district, and the منطقه number as an integer.
  //
  // parent_no exists because the two source files spell the same district differently --
  // map.tehran.ir writes "منطقه ۱۴ شهر تهران" and our own mahalle.geojson writes
  // "منطقه 14" -- and UNIQUE(name, level, parent_name) joins on the name. An integer
  // cannot be spelled two ways, so the 369 محله resolve to their منطقه regardless.
  //
  // code is partial-unique because a hand-drawn district (is_custom = 1) has no code
  // until an operator assigns one, and a hard UNIQUE would fail the moment two of them
  // sat blank. Assigned by scripts/assign-district-codes.ts, never here: a code written
  // during boot would renumber on every seed and invalidate every printed route sheet.
  const districtCodeCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCodeCols.some((c) => c.name === "code")) {
    db.exec("ALTER TABLE districts ADD COLUMN code TEXT");
  }
  if (!districtCodeCols.some((c) => c.name === "parent_no")) {
    db.exec("ALTER TABLE districts ADD COLUMN parent_no INTEGER");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ix_districts_code ON districts(code) WHERE code IS NOT NULL");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/district-code-uniqueness.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Write the assignment script**

Create `scripts/assign-district-codes.ts`:

```ts
// One-time setup: give every district its short code, and every محله its
// west-to-east ordinal within its منطقه.
//
// Run once, AFTER the seeds and AFTER split-districts.ts:
//   node --experimental-strip-types scripts/assign-district-codes.ts [--dry-run]
//
// Separate from the seeds on purpose. A code written during seeding would be
// recomputed on every re-run, so a split would renumber existing districts and every
// printed route sheet would silently point somewhere else. `WHERE code IS NULL` makes
// this pass idempotent instead: it fills what is missing and never touches what exists.
//
// Safe to re-run. Prints what it would change and writes nothing unless --apply, or
// unless neither flag is given (it writes by default, so pass --dry-run to see first).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parentNoFromName, codeForMantaghe, mahalleCode, orderedMahalle } from "../lib/districtCodes.ts";

// Opens the database directly rather than through lib/db.ts: a one-shot data pass has
// no business running migrations, and lib/db.ts pulls in the rest of the app, which Node's
// type stripping cannot resolve without a bundler. This is the same reasoning, and the
// same import, as scripts/split-districts.ts:22.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");

const dryRun = process.argv.includes("--dry-run");
const db = new DatabaseSync(DB_PATH);

interface Row { id: number; name: string; level: string; parent_name: string; code: string | null; boundary_geojson: string; }

const rows = db
  .prepare("SELECT id, name, level, parent_name, code, boundary_geojson FROM districts ORDER BY id")
  .all() as unknown as Row[];

if (rows.length === 0) {
  console.error("districts is empty — run seed-districts.ts, seed-bakhsh.ts and seed-outer-towns.ts first.");
  process.exit(1);
}

const firstVertex = (geo: string): { lng: number; lat: number } | null => {
  try {
    const g = JSON.parse(geo) as { type: string; coordinates: number[][][] };
    const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
    if (!ring || !ring.length) return null;
    return { lng: ring[0][0], lat: ring[0][1] };
  } catch {
    return null;
  }
};

// parent_no for every row, derived from the name so it cannot drift from the source file.
const parentNoById = new Map<number, number | null>();
for (const r of rows) {
  const raw = r.level === "mahalle" ? r.parent_name : r.name;
  parentNoById.set(r.id, parentNoFromName(raw ?? ""));
}

const updates: { id: number; code: string; what: string }[] = [];

// منطقه / بخش / town: Tehran's own number, or a letter.
let townIndex = 0;
const townIndexByName = new Map<string, number>();
for (const r of rows.filter((r) => r.level === "mantaghe")) {
  if (r.code) continue;
  if (parentNoById.get(r.id) !== null) {
    updates.push({ id: r.id, code: codeForMantaghe(parentNoById.get(r.id)!, r.name), what: r.name });
    continue;
  }
  townIndex += 1;
  // A stable per-name index, so a re-run gives پردیس the same P1 it had before.
  const key = r.name.replace(/^بخش\s+/, "");
  const n = (townIndexByName.get(key) ?? 0) + 1;
  townIndexByName.set(key, n);
  updates.push({ id: r.id, code: codeForMantaghe(null, r.name, n), what: r.name });
}

// محله: parent number + west-to-east ordinal within the parent.
const byParent = new Map<number, { name: string; lng: number; lat: number; id: number }[]>();
for (const r of rows.filter((r) => r.level === "mahalle")) {
  if (r.code) continue;
  const p = parentNoById.get(r.id);
  if (p === null || p === undefined) continue; // declared parent has no number: reported below
  const v = firstVertex(r.boundary_geojson);
  if (!v) continue;
  const list = byParent.get(p) ?? [];
  list.push({ name: r.name, lng: v.lng, lat: v.lat, id: r.id });
  byParent.set(p, list);
}
for (const [parentNo, list] of [...byParent.entries()].sort((a, b) => a[0] - b[0])) {
  orderedMahalle(list).forEach((m, i) => {
    updates.push({ id: m.id, code: mahalleCode(parentNo, i + 1), what: `${m.name} (منطقه ${parentNo})` });
  });
}

const orphan = rows.filter((r) => r.level === "mahalle" && parentNoById.get(r.id) === null && !r.code);
if (orphan.length) {
  console.log(`${orphan.length} محله name(s) no parent number -- left uncoded, report them:`);
  for (const r of orphan) console.log(`   ${r.name} (parent_name=${JSON.stringify(r.parent_name)})`);
}

if (updates.length === 0) {
  console.log(`nothing to do — all ${rows.length} districts already have a code`);
  db.close();
  process.exit(0);
}

// A collision would mean the ordinal is not a function of the geometry, which the tests
// say it is. Abort rather than write a duplicate the unique index would reject halfway
// through the transaction anyway.
const seen = new Map<string, number>();
for (const u of updates) {
  const prev = seen.get(u.code);
  if (prev !== undefined) {
    console.error(`ABORT: code ${u.code} would be assigned to two districts (ids ${prev}, ${u.id}).`);
    db.close();
    process.exit(1);
  }
  seen.set(u.code, u.id);
}

console.log(`${dryRun ? "would assign" : "assigning"} ${updates.length} code(s) across ${rows.length} districts:`);
for (const u of updates.slice(0, 40)) console.log(`   ${u.code.padEnd(6)} ${u.what}`);
if (updates.length > 40) console.log(`   ... and ${updates.length - 40} more`);

if (dryRun) {
  console.log("\ndry run — pass without --dry-run to write");
  db.close();
} else {
  const upd = db.prepare("UPDATE districts SET code = ? WHERE id = ? AND code IS NULL");
  db.exec("BEGIN");
  try {
    for (const u of updates) upd.run(u.code, u.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const total = db.prepare("SELECT COUNT(*) c FROM districts WHERE code IS NOT NULL").get() as { c: number };
  console.log(`\n${total.c} of ${rows.length} districts now have a code`);
}
db.close();
```

- [ ] **Step 6: Dry-run it**

Run: `node --experimental-strip-types scripts/assign-district-codes.ts --dry-run`
Expected: a count, then a table like `14 منطقه 14` / `1401 …`. **It must not have written anything** — re-check the count is unchanged:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/routeflow.db',{readOnly:true});console.log('coded:',db.prepare('SELECT COUNT(*) c FROM districts WHERE code IS NOT NULL').get().c);"
```

Expected: `coded: 0`.

- [ ] **Step 7: Apply it**

Run: `node --experimental-strip-types scripts/assign-district-codes.ts`
Expected: `N of N districts now have a code`.

- [ ] **Step 8: Verify idempotence — the stability guarantee**

```bash
node --experimental-strip-types scripts/assign-district-codes.ts
```
Expected: `nothing to do — all N districts already have a code`.

This is the single most important line of proof in the plan. A re-run must never renumber.

- [ ] **Step 9: Verify zero collisions and a sane shape**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
console.log('total:', db.prepare('SELECT COUNT(*) c FROM districts').get().c);
console.log('coded:', db.prepare('SELECT COUNT(*) c FROM districts WHERE code IS NOT NULL').get().c);
console.log('distinct codes:', db.prepare('SELECT COUNT(DISTINCT code) c FROM districts WHERE code IS NOT NULL').get().c);
console.log('by level:', JSON.stringify(db.prepare('SELECT level, COUNT(*) c, SUM(code IS NOT NULL) coded FROM districts GROUP BY level').all()));
console.log('sample:', JSON.stringify(db.prepare(\"SELECT code, name FROM districts WHERE code IS NOT NULL ORDER BY code LIMIT 12\").all()));
"
```

Expected: `distinct codes` equals `coded` (no collisions), and the sample runs `14`, `1401`, `1402`, … `P1`, `RB1`.

- [ ] **Step 10: Verify west→east actually holds in the stored codes**

The property the whole scheme rests on:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
const rows=db.prepare(\"SELECT code, name, boundary_geojson FROM districts WHERE level='mahalle' AND code IS NOT NULL ORDER BY code\").all();
function lng(g){return JSON.parse(g).coordinates[0][0][0];}
let ok=0, bad=0, checked=0;
for(let i=1;i<rows.length;i++){
  if(rows[i].code.slice(0,-2)!==rows[i-1].code.slice(0,-2)) continue; // parent changed
  checked++;
  if(lng(rows[i].boundary_geojson)>=lng(rows[i-1].boundary_geojson)) ok++; else bad++;
}
console.log('same-parent consecutive pairs checked:',checked,'| west-to-east:',ok,'| inverted:',bad);
"
```

Expected: `inverted: 0`. A non-zero count means the ordinal is not geographic and Task 5's ordering is wrong.

- [ ] **Step 11: Commit**

```bash
git add lib/db.ts scripts/assign-district-codes.ts tests/district-code-uniqueness.test.ts
git commit -m "feat(districts): give every district a short code

code is partial-unique, because a hand-drawn district has none until an
operator assigns one and a hard UNIQUE would fail the moment two sat
blank. parent_no is an INTEGER because the source file and ours spell the
same district differently -- map.tehran.ir writes منطقه ۱۴ and we write
منطقه 14 -- and an integer cannot be spelled two ways.

Assignment is its own pass, not part of the seeds. A code written during
seeding is recomputed on every re-run, so a split would renumber existing
districts and every printed route sheet would silently point somewhere
else. WHERE code IS NULL makes it idempotent instead, and the plan proves
it by running it twice and diffing.

Verified after seeding: zero collisions, a second run is a no-op, and
sorting a محله's code within its منطقه walks west to east with zero
inversions -- which is the property the alphabetical first attempt failed
2/25 and 0/27."
```

---

### Task 7: A custom district must beat the بخش containing it

**Fixes landmine 2.** Without this, §2.4's central promise is false: every unknown place would be filed under the coarse بخش and an operator's drawn boundary silently ignored.

**Files:**
- Modify: `lib/groups.ts:51-52` and `:81-83`
- Test: `tests/district-custom-precedence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/district-custom-precedence.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-dprec-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { districtIdForPoint, groupForPoint, recomputeCustomerGroups } = await import("@/lib/groups");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function square(lng: number, lat: number, size = 0.2) {
  const h = size / 2;
  return JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]],
  });
}

const ins = getDb().prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
   VALUES (?, ?, '', ?, 'unknown', ?, ?)`
);
const now = new Date().toISOString();
const coarse = Number(ins.run("بخش رودهن", "mantaghe", square(51.93, 35.73, 0.4), 0, now).lastInsertRowid);
const custom = Number(ins.run("هراز", "mantaghe", square(51.93, 35.73, 0.04), 1, now).lastInsertRowid);

describe("a hand-drawn district beats the coarse one containing it", () => {
  // Both rows are level='mantaghe' -- a بخش is stored at the same level a drawn district
  // gets, because the CHECK allows only ('mantaghe','mahalle'). So the existing
  // `ORDER BY CASE level ... END, id` falls through to id, and the custom district --
  // always inserted later -- always lost. Verified before this test was written.
  it("resolves a point inside the custom district to the custom district", () => {
    expect(districtIdForPoint(getDb(), 35.73, 51.93)).toBe(custom);
  });

  it("still resolves a point outside it to the coarse district", () => {
    expect(districtIdForPoint(getDb(), 35.85, 51.93)).toBe(coarse);
  });

  // The two functions carry the same ORDER BY. If they drift, the backfill and the app
  // classify the same point two different ways -- which is worse than either being wrong.
  it("agrees with recomputeCustomerGroups on the same point", () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (customer_code, business_name, lat, lng, organization_id, synced_at) VALUES ('C1','ت',?,?,1,?)")
      .run(35.73, 51.93, now);
    recomputeCustomerGroups(db);
    const row = db.prepare("SELECT group_id FROM customers WHERE customer_code = 'C1'").get() as { group_id: number | null };
    // groupForPoint must agree with what recomputeCustomerGroups just wrote.
    expect(row.group_id).toBe(groupForPoint(db, 35.73, 51.93));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/district-custom-precedence.test.ts`
Expected: the first test **FAILS**, returning `coarse` where `custom` is expected. The second passes.

- [ ] **Step 3: Fix the ORDER BY — both places**

In `lib/groups.ts`, the query inside `districtIdForPoint` (`:51-52`):

```ts
      `SELECT id, level, group_id, boundary_geojson FROM districts
       ORDER BY is_custom DESC, CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
```

And the identical query inside `recomputeCustomerGroups` (`:81-83`):

```ts
      `SELECT id, level, group_id, boundary_geojson FROM districts
       ORDER BY is_custom DESC, CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
```

- [ ] **Step 4: Update the comment above `districtIdForPoint`**

The existing comment at `:41-47` explains only the mahalle/mantaghe ordering and is now incomplete. Replace it with:

```ts
/** The district whose boundary contains the point, or null.
 *
 *  Two rules, in this order:
 *
 *  1. **A hand-drawn district wins.** `is_custom DESC` first, because a boundary an
 *     operator drew is a deliberate, finer statement about a place and must beat the
 *     coarse administrative polygon underneath it. This ordering is not cosmetic: a
 *     بخش is stored at level='mantaghe' -- the same level a drawn district gets, since
 *     the CHECK allows only two values -- so without is_custom the tie fell through to
 *     `id` and the custom district, always inserted later, always lost. Every drawn
 *     boundary would have been silently ignored.
 *
 *  2. **Finer before coarser.** Every محله sits inside a منطقه, so a point inside one is
 *     inside both, and territory is assigned at the finer level. Testing coarse-first
 *     would hand every point to the enclosing منطقه and make neighbourhood assignment
 *     meaningless.
 *
 *  recomputeCustomerGroups must carry the identical ORDER BY. If the two drift, a
 *  backfill and the running app classify the same point two different ways. */
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/district-custom-precedence.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Confirm no other query needs the same change**

```bash
grep -rn "FROM districts" --include=*.ts lib app | grep -i "order by"
```

Expected: only the two in `lib/groups.ts`. Any third needs the same `is_custom DESC`.

- [ ] **Step 7: Run the neighbouring suites**

Run: `npx vitest run tests/groups.test.ts tests/crm-schema.test.ts tests/districtSplit.test.ts`
Expected: PASS. `recomputeCustomerGroups` is used by the CRM import path, so this is the regression net.

- [ ] **Step 8: Type check and commit**

```bash
npx tsc --noEmit
git add lib/groups.ts tests/district-custom-precedence.test.ts
git commit -m "fix(districts): let a hand-drawn district win over the bakhsh around it

A bakhsh is stored at level='mantaghe' -- the same level a drawn district
gets, because the CHECK allows only two values. So districtIdForPoint's
ORDER BY fell through to id, and a custom district, always inserted after
the seeds, always lost. Verified on a two-row database: a point inside a
custom Heraz polygon resolved to the bakhsh.

That made the spec's central promise false. Draw a boundary for a place
the seed data never had, and every pin there would have been filed under
the coarse bakhsh and the drawn edge ignored -- silently, because the
point still matched something.

is_custom DESC goes first: a boundary an operator drew is a deliberate,
finer statement and beats the administrative polygon underneath it.
recomputeCustomerGroups carries the same ORDER BY and now must too, or a
backfill and the running app would classify one point two different ways
-- which is worse than either being wrong."
```

---

### Task 8: Backfill `district_id`, and prove the net

**Files:**
- Create: `scripts/backfill-districts.ts`
- Create: `tests/district-coverage.test.ts`

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-districts.ts`:

```ts
// One-time setup: point every located pin and customer at its district.
//
// Run once, AFTER the seeds, the split and the code pass:
//   node --experimental-strip-types scripts/backfill-districts.ts [--apply]
//
// Dry-run by default, like split-districts.ts, because it writes to rows a rep has
// already looked at.
//
// A script and not a boot migration, deliberately. lib/db.ts contains a rule that
// tests/no-one-shot-data-migration.test.ts enforces: a data-dependent migration may
// not be guarded by an app_meta marker, because a row that arrives after the marker is
// written would wait forever. This backfill's predicate is about rows, so it belongs
// out here where a human runs it once, in order, deliberately.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pointInRing } from "../lib/trafficZones.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const apply = process.argv.includes("--apply");

const db = new DatabaseSync(DB_PATH);

/** The same ordering districtIdForPoint uses (lib/groups.ts:51-52), so a backfilled
 *  district_id is bit-identical to what a later write would compute. Two copies of this
 *  rule drifting apart is exactly the bug Task 7's third test guards. */
interface D { id: number; level: string; is_custom: number; boundary_geojson: string }
const districts = db
  .prepare("SELECT id, level, is_custom, boundary_geojson FROM districts ORDER BY is_custom DESC, CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id")
  .all() as unknown as D[];

function outerRings(geojson: string): [number, number][][] {
  try {
    const p = JSON.parse(geojson) as { type?: string; coordinates?: unknown };
    if (p.type === "Polygon") return p.coordinates as [number, number][][];
    if (p.type === "MultiPolygon") return (p.coordinates as [number, number][][][]).map((x) => x[0]);
    return [];
  } catch {
    return [];
  }
}
const prepared = districts.map((d) => ({ id: d.id, rings: outerRings(d.boundary_geojson) }));

function districtFor(lat: number, lng: number): number | null {
  for (const d of prepared) for (const ring of d.rings) if (pointInRing(lng, lat, ring)) return d.id;
  return null;
}

interface Row { id: number; label: string; lat: number | null; lng: number | null; district_id: number | null }

const targets: { table: string; rows: Row[] }[] = [
  { table: "saved_locations", rows: db.prepare("SELECT id, name AS label, lat, lng, district_id FROM saved_locations").all() as unknown as Row[] },
  { table: "customers", rows: db.prepare("SELECT id, business_name AS label, lat, lng, district_id FROM customers").all() as unknown as Row[] },
];

let set = 0, unchanged = 0, noCoords = 0, matchedNothing = 0;
const unresolved: string[] = [];

db.exec("BEGIN");
try {
  for (const { table, rows } of targets) {
    const upd = db.prepare(`UPDATE ${table} SET district_id = ? WHERE id = ?`);
    for (const r of rows) {
      if (r.lat === null || r.lng === null) { noCoords++; unresolved.push(`${table}#${r.id} ${r.label} (no coordinates)`); continue; }
      const next = districtFor(r.lat, r.lng);
      if (next === null) { matchedNothing++; unresolved.push(`${table}#${r.id} ${r.label} (matches no district)`); continue; }
      if (next === r.district_id) { unchanged++; continue; }
      if (apply) upd.run(next, r.id);
      set++;
    }
  }
  if (apply) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`${apply ? "set" : "would set"} district_id on ${set} row(s); ${unchanged} already correct`);
if (unresolved.length) {
  console.log(`\n${unresolved.length} row(s) left NULL, and why:`);
  for (const u of unresolved) console.log(`   ${u}`);
  console.log("\nA row with no location has no district. That is the honest answer --");
  console.log("guessing one from a text address would be a guess wearing a foreign key.");
}
if (!apply) console.log("\ndry run -- pass --apply to write");
db.close();
```

- [ ] **Step 2: Dry-run it**

Run: `node --experimental-strip-types scripts/backfill-districts.ts`
Expected: `would set district_id on 26 row(s)` — 25 pins plus the 1 customer that has coordinates. The other 15 customers are listed as `no coordinates`.

That number is the point. The backfill is a **pin** exercise; the real payoff is that `districtIdForPoint` runs on every write from here on.

- [ ] **Step 3: Apply it**

Run: `node --experimental-strip-types scripts/backfill-districts.ts --apply`
Expected: `set district_id on 26 row(s)`.

- [ ] **Step 4: Verify every pin landed, and see where**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
console.log('pins with a district:', db.prepare('SELECT COUNT(*) c FROM saved_locations WHERE district_id IS NOT NULL').get().c, 'of', db.prepare('SELECT COUNT(*) c FROM saved_locations').get().c);
console.log('customers with a district:', db.prepare('SELECT COUNT(*) c FROM customers WHERE district_id IS NOT NULL').get().c, 'of', db.prepare('SELECT COUNT(*) c FROM customers').get().c);
console.log('by district:', JSON.stringify(db.prepare('SELECT d.name, d.code, COUNT(*) n FROM saved_locations s JOIN districts d ON d.id=s.district_id GROUP BY d.id ORDER BY n DESC').all()));
"
```

Expected: 25 of 25 pins, 1 of 16 customers, and every pin under پردیس.

- [ ] **Step 5: Write the coverage test — the net is a net**

Create `tests/district-coverage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pointInRing } from "@/lib/trafficZones";

/** The province is a net, not a hope.
 *
 *  Spec §2.4 promises that a pin anywhere in Tehran province lands in *some* district --
 *  that is what lets the design stop hand-picking towns, since a place nobody has heard
 *  of is still covered. That promise is currently verified only for the 7 towns in
 *  outer-towns.json. A grid run during review timed out at 30s, and its "63.6% gap"
 *  was mostly outside the province, because the bounding box spans most of Iran.
 *
 *  So this grids a lattice restricted to Tehran province and reports any hole by
 *  coordinate. The province box is what matters: lon 51.0-52.4, lat 35.4-35.9. */

const DATA = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", f), "utf8")) as {
  features?: { geometry: { type: string; coordinates: number[][][] | number[][][][] }; properties?: Record<string, unknown> }[];
  type?: string;
  features_length?: number;
};

function outerRings(g: { type: string; coordinates: number[][][] | number[][][][] }): [number, number][][] {
  if (g.type === "Polygon") return g.coordinates as [number, number][][];
  if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][]).map((p) => p[0]);
  return [];
}

const rings = [
  ...DATA("mahalle.geojson").features!.map((f) => outerRings(f.geometry)).flat(),
  ...DATA("bakhsh-districts.json").features!.map((f) => outerRings(f.geometry)).flat(),
  ...DATA("outer-towns.json").features!.map((f) => outerRings(f.geometry)).flat(),
  ...DATA(path.join("tehran-districts-src", "districts.json")).features!.map((f) => outerRings(f.geometry)).flat(),
];

// Tehran province, generously padded. Not the bounding box of the data -- that spans
// most of Iran and reports a gap that is not a gap.
const LON = [50.95, 52.45] as const;
const LAT = [35.35, 35.95] as const;
const STEP = 0.02; // ~2km, coarse on purpose: 75 x 30 = 2250 cells

describe("Tehran province has no hole in the district net", () => {
  it("every sampled point in the province falls in some polygon", () => {
    const holes: string[] = [];
    for (let lat = LAT[0]; lat <= LAT[1]; lat += STEP) {
      for (let lon = LON[0]; lon <= LON[1]; lon += STEP) {
        if (!rings.some((r) => pointInRing(lon, lat, r))) holes.push(`${lat.toFixed(2)},${lon.toFixed(2)}`);
      }
    }
    // By coordinate, so a hole is identifiable rather than a bare count.
    expect(holes.slice(0, 20), `${holes.length} uncovered cell(s) in Tehran province`).toEqual([]);
  });

  it("the net is loaded from all four sources, not just the towns", () => {
    // If this is 7, the net is the town list and §2.4's promise is false.
    expect(rings.length).toBeGreaterThan(400);
  });
});
```

- [ ] **Step 6: Run the coverage test**

Run: `npx vitest run tests/district-coverage.test.ts`
Expected: PASS, 2/2. **The province box is deliberately generous** — it includes mountains and desert that no administrative polygon claims. If it fails, read the reported coordinates: if they are all outside the populated corridor (east of 52.0, or north of 35.85), tighten `LON`/`LAT` to the real province extent and say so in the commit. Do not delete the test.

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill-districts.ts tests/district-coverage.test.ts
git commit -m "feat(districts): backfill pins, and prove the net has no hole

The backfill is a script, not a boot migration, on purpose. lib/db.ts
carries a rule tests/no-one-shot-data-migration.test.ts enforces: a
data-dependent migration may not sit behind an app_meta marker, because a
row arriving after the marker would wait forever. This predicate is about
rows, so it belongs out here, run once, in order, deliberately.

It sets 26 rows: 25 pins and the 1 customer that has coordinates. The other
15 customers have none at all -- they are CRM- rows named تست and x. Those
stay NULL and are reported by name, because a row with no location has no
district and guessing one from a text address would be a guess wearing a
foreign key. The backfill is a pin exercise; the real payoff is that
districtIdForPoint now runs on every write.

tests/district-coverage.test.ts grids a lattice restricted to Tehran
province and reports holes by coordinate. Spec §2.4 promises a pin anywhere
in the province lands in some district -- that promise is what lets the
design stop hand-picking towns -- and until now it was verified only for
the 7 places we happen to know about."
```

---

### Task 9: Search by code, and show it in three places

**`lib/repo/search.ts` already exists** and already has a `searchCustomers` /
`searchOrders` / `searchUsers` family, all taking `(db, session, q, limit)`, all
returning `SearchHit[]`. This task adds a fourth member. It does **not** create a new
file, and it does not invent a second matching strategy.

**Files:**
- Modify: `lib/searchModel.ts:15` (kind union), `:50` (`KINDS`)
- Modify: `lib/repo/search.ts` (new exported function, same idioms)
- Modify: `app/api/search/route.ts` (call the new function)
- Modify: the three display sites from §3.4

- [ ] **Step 1: Write the failing test**

Create `tests/district-code-search.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-dsearch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { searchDistricts } = await import("@/lib/repo/search");
const { normalisePersian } = await import("@/lib/persian");
const { MIN_REMOTE_QUERY } = await import("@/lib/searchModel");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const geo = JSON.stringify({ type: "Polygon", coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]] });
const now = new Date().toISOString();
const db = getDb();
const ins = db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
   VALUES (?, ?, '', ?, ?, 'unknown', 0, ?)`
);
ins.run("منطقه 14", "mantaghe", geo, "14", now);
ins.run("منطقه 1", "mantaghe", geo, "1", now);
for (let i = 1; i <= 26; i++) ins.run(`محله ${i}`, "mahalle", geo, `14${String(i).padStart(2, "0")}`, now);

const session = { role: "owner", organizationId: 1, user: { id: 1 } } as never;

describe("district search by code", () => {
  it("finds منطقه 14 by its own code", () => {
    expect(searchDistricts(db, session, "14", 5)[0]?.label).toBe("منطقه 14");
  });

  // The reason this is a prefix search. A substring match would make one keystroke
  // return منطقه 1 plus all 26 of 1401-1426, which is 27 rows for "1".
  it("does not flood the result set with every 14xx", () => {
    expect(searchDistricts(db, session, "14", 5).length).toBeLessThanOrEqual(5);
  });

  it("does not let '1' return every 14xx", () => {
    expect(searchDistricts(db, session, "1", 5).some((h) => h.id === "district:3")).toBe(false);
  });

  it("finds a محله by its code", () => {
    expect(searchDistricts(db, session, "1405", 5)[0]?.id).toBe("district:7");
  });

  // matchesQuery folds ي/ی, ك/ک and digit sets; the existing family relies on it and so
  // must this one, or "۱۴" would miss a district "14" would find.
  it("treats Persian and ASCII digits as one query", () => {
    expect(normalisePersian("۱۴")).toBe(normalisePersian("14"));
    expect(searchDistricts(db, session, "۱۴", 5)[0]?.label).toBe("منطقه 14");
  });

  it("respects the same two-character floor as every other kind", () => {
    expect(searchDistricts(db, session, "1", 5)).toEqual([]);
    expect(MIN_REMOTE_QUERY).toBe(2);
  });

  it("is visible to every role, because districts are shared", () => {
    // Unlike customers, which are owner + group_manager only. A driver searching "1405"
    // must find the place they are being sent to.
    const driver = { role: "driver", organizationId: 1, user: { id: 1 } } as never;
    expect(searchDistricts(db, driver, "14", 5).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/district-code-search.test.ts`
Expected: FAIL — `searchDistricts` is not exported.

- [ ] **Step 3: Add the kind to the union and the parser**

`lib/searchModel.ts:15`:

```ts
export type SearchKind = "page" | "customer" | "order" | "user" | "district";
```

`lib/searchModel.ts:50` — `district` must join `KINDS`, or `isHit` (`:56`) rejects a
stored district recent and it silently vanishes on the next visit:

```ts
const KINDS: readonly string[] = ["page", "customer", "order", "user", "district"];
```

- [ ] **Step 4: Add the search function to `lib/repo/search.ts`**

Append to the file, following `searchOrders` exactly:

```ts
/** Districts, for the overlay. The code lookup is a PREFIX match, and that is the whole
 *  design.
 *
 *  Substring matching would make one keystroke useless: "1" would return منطقه 1 plus
 *  all 26 of 1401-1426, and "14" the same 27 rows. Prefix narrows "14" to منطقه 14 and
 *  lets a longer query walk down into the محله beneath it. So the SQL narrows on the
 *  indexed code column and matchesQuery does what it does everywhere else in this file
 *  -- folding ي/ی, ك/ک and digit sets, which LIKE does not.
 *
 *  Ordered by LENGTH(code) so a two-digit منطقه outranks the four-digit محله under it:
 *  asking for "14" wants the district, not the 26 neighbourhoods inside it.
 *
 *  No role gate, unlike searchCustomers. Districts are shared reference data (spec §2.6)
 *  and carry no tenant row, so there is nothing to scope and nothing to leak -- and a
 *  driver who is sent to ۱۴۰۵ has to be able to look it up. */
export function searchDistricts(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  void session; // deliberately unscoped -- see above
  if (tooShort(q)) return [];
  const rows = db
    .prepare(
      `SELECT id, name, code FROM districts
        WHERE code IS NOT NULL AND code LIKE ? ESCAPE '\\'
        ORDER BY LENGTH(code), code`,
    )
    .all(`${escapeLike(normalisePersian(q.trim()))}%`) as unknown as {
    id: number; name: string; code: string;
  }[];
  return rows
    .filter((r) => matchesQuery(`${r.name} ${r.code}`, q))
    .slice(0, limit)
    .map((r) => ({
      kind: "district",
      id: `district:${r.id}`,
      label: r.name,
      sub: r.code,
      href: `/map?district=${r.id}`,
    }));
}

/** LIKE treats % and _ as wildcards, so a query of "5%" would otherwise return every
 *  code ending in 5 -- a search box producing nonsense rather than an error. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
```

- [ ] **Step 5: Wire it into the route**

In `app/api/search/route.ts`, add `searchDistricts` to the existing gather and push its
hits, matching however the file already combines the other three:

```ts
  hits.push(...searchDistricts(db, session, q, 6));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/district-code-search.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 7: Add the three display sites from §3.4**

The code appears in exactly three places, and is typed in none:

1. **Coverage map legend** — beside each district label, in the existing badge slot.
2. **Customer card / detail** — a dimmed secondary line: `منطقه 14 · محله ۱۴۰۵`, digits
   through `faDigits` from `lib/format.ts`, which `lib/repo/search.ts:41` already uses
   for exactly this.
3. **Printed route sheet** — `۱۴۰۵ — جابری` per stop, groups ordered by `code` and stops
   within a group by `nearestNeighborOrder` from `lib/geo.ts`.

For (1), add `code` to the `DistrictProperties` interface and to `readDistrictProperties`
in `lib/districts.ts:24-36` — one field on the existing projection, not a new endpoint.
Note `lib/districtGeometry.ts:7-12` deliberately splits immutable geometry from mutable
properties, so `code` belongs on the **properties** side, never the cached geometry
payload; putting it there would bust the geometry cache signature on every code change.

- [ ] **Step 8: Verify the digits render Persian but store ASCII**

The stored code is ASCII (`1405`) so the prefix match and the west→east sort are stable.
Confirm every display site runs it through `faDigits`/`faNum`, and that no display site
compares a rendered string against a stored one.

- [ ] **Step 9: Run the search and map suites**

```bash
npx vitest run tests/district-code-search.test.ts tests/search-model.test.ts tests/section-headings.test.ts
npx tsc --noEmit
```
Expected: PASS, 0 type errors.

- [ ] **Step 10: Commit**

```bash
git add lib/searchModel.ts lib/repo/search.ts app/api/search/route.ts components/ app/
git commit -m "feat(districts): search by code, show it in three places

A fourth member of the search family, not a new file: same
(db, session, q, limit) shape, same matchesQuery, same SearchHit.

Prefix, not substring, and that is the whole design. Substring makes one
keystroke useless -- '1' returns منطقه 1 plus all 26 of 1401-1426. The SQL
narrows on the indexed code column and matchesQuery folds what LIKE does
not, so ۱۴ finds the district 14 finds. Ordered by LENGTH(code) so a
two-digit mantaghe outranks the four-digit mahalle beneath it.

LIKE wildcards are escaped. A query of '5%' would otherwise return every
code ending in 5, which is a search box producing nonsense rather than an
error.

No role gate, unlike searchCustomers. Districts are shared reference data
and carry no tenant row, so there is nothing to scope -- and a driver sent
to ۱۴۰۵ has to be able to look it up.

code goes on DistrictProperties, not the geometry payload: geometry is
version-stamped and cached indefinitely, so a mutable field there would
bust the cache on every change."
```

---

### Task 10: Full verification

**No new behaviour. This is the task that proves the other nine did not break anything.**

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```
Expected: **0 errors**.

- [ ] **Step 2: Run every test this plan touched**

```bash
npx vitest run tests/districts-shared-reference.test.ts tests/districts-seed.test.ts \
  tests/districtCodes.test.ts tests/district-code-uniqueness.test.ts \
  tests/district-split-guard.test.ts tests/district-custom-precedence.test.ts \
  tests/district-coverage.test.ts tests/district-code-search.test.ts
```
Expected: PASS, all files.

- [ ] **Step 3: Run the guard suites that must not regress**

```bash
npx vitest run tests/no-one-shot-data-migration.test.ts tests/no-cascade-migration.test.ts \
  tests/tenancy-schema.test.ts tests/crm-schema.test.ts tests/districtSplit.test.ts
```
Expected: PASS. `no-one-shot` is the one that matters most: Task 1 edited `lib/db.ts` and added zero `app_meta` reads, so its exempt list must still be exactly right.

- [ ] **Step 4: Run the full suite in the background**

The full suite takes ~14 minutes and exceeds the 30s shell cap. Do **not** run it in the foreground — a foreground timeout almost certainly means it is still running.

```bash
setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &
```

Poll: `tail -20 /tmp/vitest.log`

**Expected:** `2 failed / 2735 passed` with exactly these two names is a **PASS**:
- `tests/jalali.test.ts` — "agrees with Intl for every day across 20 Jalali years"
- `tests/api/routing-route.test.ts` — "plans, commits and freezes"

Both are documented CPU-contention flakes under full-suite load and both pass alone. Before recording any failure, re-run that file in isolation: `npx vitest run tests/<file>`. Only a failure that reproduces alone is real. **Do not raise the global timeout to hide slowness.**

- [ ] **Step 5: Verify the end state, from the data**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db',{readOnly:true});
const q=(s)=>db.prepare(s).get();
console.log('districts:      ', q('SELECT COUNT(*) c FROM districts').c);
console.log('  coded:        ', q('SELECT COUNT(*) c FROM districts WHERE code IS NOT NULL').c);
console.log('  distinct code:', q('SELECT COUNT(DISTINCT code) c FROM districts WHERE code IS NOT NULL').c, '(must equal coded)');
console.log('  by level:     ', JSON.stringify(db.prepare('SELECT level, COUNT(*) n FROM districts GROUP BY level').all()));
console.log('pins located:   ', q('SELECT COUNT(*) c FROM saved_locations WHERE district_id IS NOT NULL').c, 'of', q('SELECT COUNT(*) c FROM saved_locations').c);
console.log('org column gone:', !db.prepare('PRAGMA table_info(districts)').all().some(c=>c.name==='organization_id'));
"
```

Expected: 432+ districts, all coded, `distinct code` == `coded`, 25/25 pins, `org column gone: true`.

- [ ] **Step 6: Commit any straggler**

```bash
git status --porcelain
git add -A && git commit -m "chore(districts): verification pass" || echo "nothing to commit"
```

---

## Definition of done

- [ ] `npx tsc --noEmit` reports **0 errors**
- [ ] All 8 new/updated test files pass
- [ ] `no-one-shot-data-migration`, `no-cascade-migration`, `tenancy-schema` all pass unchanged
- [ ] `districts` holds 432+ rows, every one coded, **zero code collisions**
- [ ] Re-running all three seed scripts leaves the count unchanged (the landmine)
- [ ] Re-running `assign-district-codes.ts` is a no-op (the stability guarantee)
- [ ] Sorting a محله's codes within its منطقه walks west→east with **0 inversions**
- [ ] 25/25 pins carry a `district_id`; 15 customers with no coordinates are reported, not guessed
- [ ] A custom district nested in a بخش wins
- [ ] `PRAGMA table_info(districts)` has no `organization_id`
- [ ] Full suite: `2 failed / 2735 passed` with only the two known flakes

## Rollback

Every step is additive and the seeds are re-runnable. To undo:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/routeflow.db');
db.exec('DROP TABLE IF EXISTS districts');
db.close();
console.log('districts dropped; the boot migration recreates it empty on next start');
"
git revert <the commits, newest first>
```

Dropping `districts` is safe at any point: no customer holds a live reference until Task 8, and `district_id` is nullable, so worst case the 25 pins go back to NULL and are re-derivable.
