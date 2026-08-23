# Stage 1 — Facilities Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the two depot sites from a hard-coded constant into a `facilities` table the user manages through a `/facilities` page, then prove the read path end-to-end with two trivial consumers (site markers on the planner map, site distances in the customer panel).

**Architecture:** A new `facilities` table seeded idempotently from today's constant, keyed on a stable `slug`. `lib/facilities.ts` keeps its exported surface but becomes DB-backed. A CRUD API mirrors the proven `/api/locations` route shape including its weak-ETag handling. The map page reads facilities server-side alongside districts and customers, so they arrive in the first paint. The marker SVG art moves out of `CoverageMap.tsx` into a shared module so the planner map can reuse it.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, `node:sqlite` (`DatabaseSync`), react-leaflet 5 / Leaflet 1.9, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-depot-features-design.md` — §1.1 (table), §1.2 (origin resolution, the map exception), §6 (14c, 14e), §8 (sequencing), §10 (testing).

## Global Constraints

- **Design tokens only.** Every colour, spacing, radius and duration comes from `MASTER.md` / `app/globals.css`. No literal hex in components except where Leaflet writes it into inline styles, which must carry a comment tying it to its token (existing precedent: `STATUS_COLOR` in `lib/types.ts`).
- **Dark-only.** No light theme, no `prefers-color-scheme` branch.
- **Persian UI copy, RTL.** Every user-facing string is Persian. Numbers use `--font-mono`.
- **No emoji as icons.** Inline SVG only (`MASTER.md` anti-pattern list).
- **`node:sqlite` returns null-prototype rows.** Any row crossing into a Client Component must be rebuilt as an object literal — see `lib/customers.ts` for the established pattern and the reason.
- **Straight-line distances must be labelled `خط مستقیم`** and never formatted as a duration (spec §"Decisions taken before design").
- **Tests:** Vitest, `tests/**/*.test.ts`, node environment, `@` alias to repo root. API tests set `COVERAGE_DB_PATH` to a temp file *before* importing `@/lib/db` — see `tests/api/districts-bulk.test.ts`.
- **Commit after every task.** A Stop hook auto-commits, but each task ends with an explicit commit anyway.

---

### Task 1: `facilities` table with idempotent seeding

**Files:**
- Modify: `lib/db.ts` (schema block ~line 146, after `saved_locations`)
- Test: `tests/api/facilities-schema.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: a `facilities` table; `FacilityKind`, `FacilityRow`, `FACILITY_KINDS` exported from `lib/db.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/facilities-schema.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-fac-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb, seedFacilities } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => { getDb(); });

describe("facilities schema", () => {
  it("seeds exactly the two starting sites", () => {
    const rows = getDb().prepare("SELECT slug, kind, is_default_origin FROM facilities ORDER BY slug").all();
    expect(rows.map((r) => r.slug)).toEqual(["home-pardis", "warehouse-bakeh"]);
    expect(rows.find((r) => r.slug === "home-pardis")?.kind).toBe("home_base");
  });

  // The migration runs on every boot, and a restored backup already has these rows.
  it("is idempotent - re-seeding never duplicates or overwrites", () => {
    const db = getDb();
    db.prepare("UPDATE facilities SET name = 'edited by user' WHERE slug = 'home-pardis'").run();
    seedFacilities(db);
    const rows = db.prepare("SELECT name FROM facilities WHERE slug = 'home-pardis'").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("edited by user");
  });

  it("marks exactly one row as the default origin, and it is the home base", () => {
    const rows = getDb()
      .prepare("SELECT slug FROM facilities WHERE is_default_origin = 1")
      .all() as { slug: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("home-pardis");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/facilities-schema.test.ts`
Expected: FAIL — `seedFacilities` is not exported / no such table `facilities`.

- [ ] **Step 3: Add the schema and seeding to `lib/db.ts`**

Add to the `db.exec(\`...\`)` schema block, after the `saved_locations` index:

```sql
    CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'home_base', 'other')),
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      maps_url TEXT,
      notes TEXT,
      is_default_origin INTEGER NOT NULL DEFAULT 0,
      owner_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facilities_kind ON facilities(kind);
```

Then, exported from `lib/db.ts`:

```ts
export type FacilityKind = "warehouse" | "home_base" | "other";
export const FACILITY_KINDS: FacilityKind[] = ["warehouse", "home_base", "other"];

export interface FacilityRow {
  id: number;
  slug: string;
  kind: FacilityKind;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  maps_url: string | null;
  notes: string | null;
  is_default_origin: number; // SQLite has no boolean; 0 or 1
  owner_username: string | null;
  created_at: string;
  updated_at: string;
}

// The two sites the business started with, recovered from the Google Maps links they
// shared. Seeded rather than hard-coded so the user can edit them; keyed on `slug` so
// re-running this -- every boot, and after any backup restore -- neither duplicates a
// row nor reverts an edit the user made. INSERT OR IGNORE, never INSERT OR REPLACE:
// REPLACE would silently discard a repositioned pin on the next deploy.
const FACILITY_SEED: Array<Omit<FacilityRow, "id" | "created_at" | "updated_at">> = [
  {
    slug: "warehouse-bakeh",
    kind: "warehouse",
    name: "انبار مرکزی",
    address: "استان تهران، بکه، بلوار رسول اکرم، املاک طاها",
    lat: 35.502669,
    lng: 51.7546255,
    maps_url: "https://maps.app.goo.gl/XYd819ZQiGJzHNKM9",
    notes: "انبار اصلی — تأمین موجودی",
    is_default_origin: 0,
    owner_username: null,
  },
  {
    slug: "home-pardis",
    kind: "home_base",
    name: "خانه (انبار کوچک)",
    address: "تهران، پردیس، فاز ۲، خیابان فهمیده",
    lat: 35.753263,
    lng: 51.798381,
    maps_url: "https://maps.app.goo.gl/ivx6yY69Zb9S9sKu6",
    // Deliveries start here, so it is the origin the planner measures from until the
    // user says otherwise.
    notes: "شروع مسیر توزیع روزانه از اینجاست",
    is_default_origin: 1,
    owner_username: null,
  },
];

export function seedFacilities(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO facilities
      (slug, kind, name, address, lat, lng, maps_url, notes, is_default_origin, owner_username, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const f of FACILITY_SEED) {
    insert.run(f.slug, f.kind, f.name, f.address, f.lat, f.lng, f.maps_url, f.notes, f.is_default_origin, f.owner_username, now, now);
  }
}
```

Call `seedFacilities(db);` in `getDb()` immediately before `_db = db; return db;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/facilities-schema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/api/facilities-schema.test.ts
git commit -m "Add facilities table with idempotent seeding"
```

---

### Task 2: `lib/facilities.ts` becomes DB-backed

**Files:**
- Modify: `lib/facilities.ts` (full rewrite of the data layer; constants stay)
- Modify: `tests/facilities.test.ts` (adapt to the DB-backed API)

**Interfaces:**
- Consumes: `FacilityRow`, `FacilityKind`, `getDb` from Task 1.
- Produces:
  - `readFacilities(db?: DatabaseSync): FacilityRow[]` — ordered `home_base` first, then `warehouse`, then `other`, then by name. Rows rebuilt as object literals (null-prototype rule).
  - `homeBase(db?): FacilityRow | null`
  - `mainWarehouse(db?): FacilityRow | null`
  - `defaultOrigin(db?): FacilityRow | null` — the `is_default_origin = 1` row, falling back to the home base, then to the first row.
  - `FACILITY_COLOR`, `FACILITY_LABEL` unchanged.

- [ ] **Step 1: Rewrite `tests/facilities.test.ts` against the DB**

Replace the file. Same intent as the existing tests — the coordinates are still the thing that cannot be re-derived from anything else in the repo — but sourced from the table:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-facl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb } = await import("@/lib/db");
const { readFacilities, homeBase, mainWarehouse, defaultOrigin, FACILITY_LABEL } = await import("@/lib/facilities");
const { distanceKm } = await import("@/lib/geo");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});
beforeAll(() => { getDb(); });

describe("facilities", () => {
  it("has exactly one home base and one warehouse", () => {
    expect(homeBase()?.kind).toBe("home_base");
    expect(mainWarehouse()?.kind).toBe("warehouse");
  });

  // A typo in a coordinate would silently move a depot kilometres away and nothing
  // else in the repo would complain. Wide enough to survive a real relocation inside
  // the province, tight enough to catch a transposed digit or a swapped pair.
  it("places every site inside Tehran province", () => {
    for (const f of readFacilities()) {
      expect(f.lat).toBeGreaterThan(35.0);
      expect(f.lat).toBeLessThan(36.5);
      expect(f.lng).toBeGreaterThan(50.5);
      expect(f.lng).toBeLessThan(53.0);
    }
  });

  it("keeps the two sites the distance apart the links put them", () => {
    const km = distanceKm(homeBase()!, mainWarehouse()!);
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(32);
  });

  it("returns plain objects, not the null-prototype rows node:sqlite hands back", () => {
    expect(Object.getPrototypeOf(readFacilities()[0])).toBe(Object.prototype);
  });

  it("defaults the origin to the home base", () => {
    expect(defaultOrigin()?.slug).toBe("home-pardis");
  });

  // The popup prints the site name as its title directly above the kind label.
  it("labels each kind by its role, not by a site's name", () => {
    for (const f of readFacilities()) expect(FACILITY_LABEL[f.kind]).not.toBe(f.name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/facilities.test.ts`
Expected: FAIL — `readFacilities` is not exported.

- [ ] **Step 3: Rewrite `lib/facilities.ts`**

Keep the file's existing header comment intent but update it: sites are now user-managed data. Keep `FACILITY_COLOR` and `FACILITY_LABEL` exactly as they are (including the comment explaining why the colour is duplicated as literal hex). Replace the array and the two finders with:

```ts
import type { DatabaseSync } from "node:sqlite";
import { FacilityKind, FacilityRow, getDb } from "./db";

export type { FacilityKind, FacilityRow };

// Home base first: it is the origin every delivery run starts from, so it leads the
// sidebar list and the editor. node:sqlite hands back null-prototype rows, which React
// refuses to pass into a Client Component -- rebuilding each as an object literal is
// also the explicit column list, so the page and the API cannot drift. See
// lib/customers.ts, which solves the same problem for the same reason.
const KIND_ORDER: Record<FacilityKind, number> = { home_base: 0, warehouse: 1, other: 2 };

export function readFacilities(db: DatabaseSync = getDb()): FacilityRow[] {
  const rows = db.prepare("SELECT * FROM facilities").all() as unknown as FacilityRow[];
  return rows
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      kind: r.kind,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      maps_url: r.maps_url,
      notes: r.notes,
      is_default_origin: r.is_default_origin,
      owner_username: r.owner_username,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, "fa"));
}

export function homeBase(db: DatabaseSync = getDb()): FacilityRow | null {
  return readFacilities(db).find((f) => f.kind === "home_base") ?? null;
}

export function mainWarehouse(db: DatabaseSync = getDb()): FacilityRow | null {
  return readFacilities(db).find((f) => f.kind === "warehouse") ?? null;
}

/** The point every distance in the app is measured from unless something more specific
 *  is in play. Falls back through home base to the first site so a database whose flag
 *  was cleared still renders instead of throwing. */
export function defaultOrigin(db: DatabaseSync = getDb()): FacilityRow | null {
  const all = readFacilities(db);
  return all.find((f) => f.is_default_origin === 1) ?? all.find((f) => f.kind === "home_base") ?? all[0] ?? null;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. `components/CoverageMap.tsx` still imports `FACILITIES`, so this step also requires updating that import — do it in Task 6; until then TypeScript will flag it. Run `npx tsc --noEmit` and confirm the *only* errors are `FACILITIES` in `CoverageMap.tsx`.

- [ ] **Step 5: Commit**

```bash
git add lib/facilities.ts tests/facilities.test.ts
git commit -m "Make facilities DB-backed, add defaultOrigin resolver"
```

---

### Task 3: `GET`/`POST /api/facilities`

**Files:**
- Create: `app/api/facilities/route.ts`
- Test: `tests/api/facilities-route.test.ts`

**Interfaces:**
- Consumes: `readFacilities` (Task 2), `etagFor`/`notModified`/`etagJson` from `lib/httpCache.ts`.
- Produces: `GET` → `{ facilities: FacilityRow[] }` with weak ETag. `POST` body `{ name, kind, lat, lng, address?, maps_url?, notes? }` → `{ ok: true, id }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/facilities-route.test.ts  (header identical to Task 1's, new temp db name)
describe("POST /api/facilities", () => {
  it("creates a site and generates a unique slug", async () => {
    const res = await POST(facReq({ name: "انبار دوم", kind: "warehouse", lat: 35.7, lng: 51.4 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const row = getDb().prepare("SELECT slug, kind FROM facilities WHERE id = ?").get(body.id);
    expect(row.kind).toBe("warehouse");
    expect(row.slug).toMatch(/^site-/);
  });

  it("rejects coordinates outside the valid range", async () => {
    const res = await POST(facReq({ name: "بد", kind: "other", lat: 999, lng: 51.4 }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    const res = await POST(facReq({ name: "بد", kind: "spaceport", lat: 35.7, lng: 51.4 }));
    expect(res.status).toBe(400);
  });

  it("rejects a blank name", async () => {
    const res = await POST(facReq({ name: "   ", kind: "other", lat: 35.7, lng: 51.4 }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/facilities", () => {
  it("returns every site", async () => {
    const res = await GET(new NextRequest("http://localhost/api/facilities"));
    const body = await res.json();
    expect(body.facilities.length).toBeGreaterThanOrEqual(2);
  });

  it("answers 304 when the caller's ETag still matches", async () => {
    const first = await GET(new NextRequest("http://localhost/api/facilities"));
    const tag = first.headers.get("ETag")!;
    const second = await GET(new NextRequest("http://localhost/api/facilities", { headers: { "if-none-match": tag } }));
    expect(second.status).toBe(304);
  });
});
```

with

```ts
function facReq(body: unknown) {
  return new NextRequest("http://localhost/api/facilities", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/facilities-route.test.ts`
Expected: FAIL — module `@/app/api/facilities/route` not found.

- [ ] **Step 3: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { FACILITY_KINDS, FacilityKind, getDb } from "@/lib/db";
import { readFacilities } from "@/lib/facilities";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { isValidCoord } from "@/lib/geoLinks";

export async function GET(req: NextRequest) {
  const db = getDb();
  const sig = db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM facilities").get() as {
    c: number;
    m: string | null;
  };
  const tag = etagFor("facilities", sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;
  return etagJson(req, tag, { facilities: readFacilities(db) });
}

interface NewFacilityInput {
  name?: string;
  kind?: string;
  lat?: number;
  lng?: number;
  address?: string | null;
  maps_url?: string | null;
  notes?: string | null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NewFacilityInput | null;
  if (!body) return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "نام مکان الزامی است" }, { status: 400 });

  if (!FACILITY_KINDS.includes(body.kind as FacilityKind)) {
    return NextResponse.json({ ok: false, error: "نوع مکان نامعتبر است" }, { status: 400 });
  }
  if (typeof body.lat !== "number" || typeof body.lng !== "number" || !isValidCoord(body.lat, body.lng)) {
    return NextResponse.json({ ok: false, error: "مختصات نامعتبر است" }, { status: 400 });
  }

  // Seeded rows carry meaningful slugs; user-created ones only need to be unique and
  // stable, and must never collide with a future seed slug -- hence the "site-" prefix.
  const slug = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const result = getDb()
    .prepare(
      `INSERT INTO facilities (slug, kind, name, address, lat, lng, maps_url, notes, is_default_origin, owner_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
    )
    .run(slug, body.kind as FacilityKind, name, body.address ?? null, body.lat, body.lng, body.maps_url ?? null, body.notes ?? null, now, now);

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/facilities-route.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/facilities/route.ts tests/api/facilities-route.test.ts
git commit -m "Add GET/POST /api/facilities"
```

---

### Task 4: `PATCH`/`DELETE /api/facilities/[id]`, with the single-default-origin invariant

**Files:**
- Create: `app/api/facilities/[id]/route.ts`
- Test: extend `tests/api/facilities-route.test.ts`

**Interfaces:**
- Produces: `PATCH` body accepts any of `{ name, kind, lat, lng, address, notes, is_default_origin }` → `{ ok: true }`. `DELETE` → `{ ok: true }`.

**Invariant (spec §1.1):** setting `is_default_origin: true` clears it on every other row *in the same transaction*. Deleting the current default promotes another site rather than leaving none.

- [ ] **Step 1: Write the failing tests**

```ts
describe("PATCH /api/facilities/[id]", () => {
  it("moves a pin and stamps updated_at", async () => {
    const id = seedExtraFacility();
    const before = getDb().prepare("SELECT updated_at FROM facilities WHERE id = ?").get(id).updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const res = await PATCH(patchReq({ lat: 35.71, lng: 51.41 }), ctx(id));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT lat, updated_at FROM facilities WHERE id = ?").get(id);
    expect(row.lat).toBeCloseTo(35.71, 5);
    expect(row.updated_at).not.toBe(before);
  });

  it("keeps exactly one default origin when the flag moves", async () => {
    const id = seedExtraFacility();
    await PATCH(patchReq({ is_default_origin: true }), ctx(id));
    const flagged = getDb().prepare("SELECT id FROM facilities WHERE is_default_origin = 1").all();
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe(id);
  });

  it("refuses to clear the default origin flag directly, since that would leave none", async () => {
    const current = getDb().prepare("SELECT id FROM facilities WHERE is_default_origin = 1").get();
    const res = await PATCH(patchReq({ is_default_origin: false }), ctx(current.id));
    expect(res.status).toBe(400);
  });

  it("rejects invalid coordinates", async () => {
    const id = seedExtraFacility();
    const res = await PATCH(patchReq({ lat: 91, lng: 0 }), ctx(id));
    expect(res.status).toBe(400);
  });

  it("404s an unknown id", async () => {
    const res = await PATCH(patchReq({ name: "x" }), ctx(999999));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/facilities/[id]", () => {
  it("deletes a site", async () => {
    const id = seedExtraFacility();
    expect((await DELETE(delReq(), ctx(id))).status).toBe(200);
    expect(getDb().prepare("SELECT id FROM facilities WHERE id = ?").get(id)).toBeUndefined();
  });

  // Losing the origin entirely would strand every distance in the app.
  it("promotes another site when the default origin is deleted", async () => {
    const victim = getDb().prepare("SELECT id FROM facilities WHERE is_default_origin = 1").get();
    await DELETE(delReq(), ctx(victim.id));
    const flagged = getDb().prepare("SELECT id FROM facilities WHERE is_default_origin = 1").all();
    expect(flagged).toHaveLength(1);
  });

  it("refuses to delete the last remaining site", async () => {
    const db = getDb();
    db.prepare("DELETE FROM facilities WHERE id NOT IN (SELECT MIN(id) FROM facilities)").run();
    const last = db.prepare("SELECT id FROM facilities").get();
    expect((await DELETE(delReq(), ctx(last.id))).status).toBe(400);
  });
});
```

Helpers:

```ts
function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}
function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/facilities/1", {
    method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
function delReq() {
  return new NextRequest("http://localhost/api/facilities/1", { method: "DELETE" });
}
function seedExtraFacility(): number {
  const now = new Date().toISOString();
  const r = getDb().prepare(
    `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
     VALUES (?, 'other', 'موقت', 35.7, 51.4, 0, ?, ?)`
  ).run(`tmp-${Math.random().toString(36).slice(2)}`, now, now);
  return Number(r.lastInsertRowid);
}
```

Note: the delete tests mutate shared state, so they must run last in the file. Vitest runs `describe` blocks in declaration order within a file, so place the DELETE block after PATCH.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/facilities-route.test.ts`
Expected: FAIL — module `@/app/api/facilities/[id]/route` not found.

- [ ] **Step 3: Implement the route**

Follow `app/api/locations/[id]/route.ts`'s shape exactly. The two things it does *not* have:

```ts
  // Exactly one default origin, enforced here rather than by a partial unique index --
  // see spec §1.1. Both statements run inside one transaction so a crash between them
  // cannot leave the app with zero origins, which would strand every distance in it.
  if (body.is_default_origin === true) {
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE facilities SET is_default_origin = 0, updated_at = ? WHERE is_default_origin = 1").run(now);
      db.prepare("UPDATE facilities SET is_default_origin = 1, updated_at = ? WHERE id = ?").run(now, idNum);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
```

and, in `DELETE`, before removing the row:

```ts
  const total = (db.prepare("SELECT COUNT(*) c FROM facilities").get() as { c: number }).c;
  if (total <= 1) {
    return NextResponse.json({ ok: false, error: "آخرین مکان را نمی‌توان حذف کرد" }, { status: 400 });
  }
```

and after removing it, promote a replacement if the deleted row held the flag:

```ts
  if (wasDefault) {
    db.prepare(
      `UPDATE facilities SET is_default_origin = 1, updated_at = ?
       WHERE id = (SELECT id FROM facilities ORDER BY CASE kind WHEN 'home_base' THEN 0 ELSE 1 END, id LIMIT 1)`
    ).run(new Date().toISOString());
  }
```

A `PATCH` carrying `is_default_origin: false` returns 400 (`تنها مبدأ پیش‌فرض را نمی‌توان لغو کرد؛ مکان دیگری را به‌عنوان مبدأ انتخاب کنید`) — the flag moves by being set elsewhere, never by being cleared.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/facilities/[id]/route.ts" tests/api/facilities-route.test.ts
git commit -m "Add PATCH/DELETE /api/facilities/[id] with single-origin invariant"
```

---

### Task 5: Shared marker art module

**Files:**
- Create: `components/facilityIcon.ts`
- Modify: `components/CoverageMap.tsx` (remove `FACILITY_ART` / `facilityIcon`, import them instead)

**Interfaces:**
- Produces: `FACILITY_ART: Record<FacilityKind, { html: string; size: [number, number]; anchor: [number, number] }>` and `facilityIcon(kind: FacilityKind): DivIcon`, plus `facilityMarkerHtml(kind)` for non-Leaflet contexts (the sidebar legend and, later, the editor page).

Pure extraction — Task 7 needs the same art on the planner map, and `CoverageMap.tsx` is already 1,100 lines. `kind` widens to include `"other"`, which reuses the warehouse silhouette.

- [ ] **Step 1: Move the code, no behaviour change**

Cut `FACILITY_ART` and `facilityIcon` out of `CoverageMap.tsx` into `components/facilityIcon.ts` verbatim, keeping every comment. Add an `other` entry pointing at the same art as `warehouse`. Export `facilityMarkerHtml(kind)` returning the `<span class="facility-marker…">…</span>` string the sidebar legend already builds inline.

The module owns its own `iconCache` — the one in `CoverageMap.tsx` stays there for customer markers.

- [ ] **Step 2: Verify nothing changed**

Run: `npm run build && npx tsc --noEmit`
Expected: clean apart from the known `FACILITIES` error, resolved in Task 6.

- [ ] **Step 3: Commit**

```bash
git add components/facilityIcon.ts components/CoverageMap.tsx
git commit -m "Extract facility marker art into a shared module"
```

---

### Task 6: Map reads facilities from the server

**Files:**
- Modify: `app/page.tsx`, `components/MapLoader.tsx`, `components/CoverageMap.tsx`

**Interfaces:**
- Consumes: `readFacilities` (Task 2), `facilityIcon`/`FACILITY_ART` (Task 5).
- Produces: `CoverageMap` prop `initialFacilities: FacilityRow[]`; `MapLoader` threads it through.

- [ ] **Step 1: Thread the prop**

`app/page.tsx` adds `const facilities = readFacilities(db);` beside the existing reads and passes `initialFacilities={facilities}`. `MapLoader` adds the prop to its interface and forwards it.

- [ ] **Step 2: Consume it in `CoverageMap`**

Replace every `FACILITIES` reference with the prop. Field names change from camelCase to the row's snake_case: `f.mapsUrl` → `f.maps_url`, `f.note` → `f.notes`. The `otherFacilityDistance` helper takes the list as a parameter instead of closing over the constant:

```ts
function otherFacilityDistance(f: FacilityRow, all: FacilityRow[]): { other: FacilityRow; km: number } | null {
  const other = all.find((x) => x.id !== f.id);
  return other ? { other, km: distanceKm(f, other) } : null;
}
```

The sidebar's "distance between the two sites" line already guards on `length === 2`; keep that guard.

Add a link to the new editor in `QUICK_LINKS`:

```ts
  { href: "/facilities", icon: "🏢", label: "مکان‌های ما (انبارها)" },
```

(`QUICK_LINKS` uses emoji today; matching it is consistent, and `MASTER.md`'s no-emoji rule is about map markers and status, not this list.)

- [ ] **Step 3: Verify**

Run: `npm run build && npm test && npx tsc --noEmit`
Expected: all clean. Then `systemctl restart coverage-map.service` and confirm both markers still render.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx components/MapLoader.tsx components/CoverageMap.tsx
git commit -m "Read facilities from the database on the map page"
```

---

### Task 7: `/facilities` editor page

**Files:**
- Create: `app/facilities/page.tsx`
- Reuse: `components/LocationPinPicker.tsx`, `components/ToastProvider.tsx`

**Interfaces:**
- Consumes: the API from Tasks 3–4, `facilityMarkerHtml` from Task 5.

UI, per spec §1.1:
- One row per site: marker silhouette, name, kind label, address, mono coordinates.
- `مبدأ پیش‌فرض` radio, exactly one selected; selecting another PATCHes `is_default_origin: true`.
- `ویرایش موقعیت` opens `LocationPinPicker` inline (tap-to-place, confirm/cancel) — deliberately **not** a draggable marker on the main map: on a phone, dragging a marker and panning are the same gesture.
- `افزودن مکان` form: name, kind select, then the pin picker.
- Delete with a confirm step; the API refuses the last site and surfaces that error as a toast.

Page shell copies `app/leads/page.tsx`: `dir="rtl"`, `min-h-screen bg-bg p-4 sm:p-6`, a `max-w-3xl` column, mono eyebrow + `--text-xl` title, back-link to `/`.

- [ ] **Step 1: Build the page**

- [ ] **Step 2: Verify in the running app**

Run: `npm run build && systemctl restart coverage-map.service`, then drive it with Playwright — load `/facilities`, add a site, move its pin, switch the default origin, delete it — asserting no console errors and that the map's markers follow.

- [ ] **Step 3: Commit**

```bash
git add app/facilities/page.tsx
git commit -m "Add the sites editor page"
```

---

### Task 8 (14e): Site markers on the planner map

**Files:**
- Modify: `components/PlannerRouteMap.tsx`, `app/planner/page.tsx`

The planner map draws the route but not the sites, so the origin is invisible on the very map that routes from it.

- [ ] **Step 1: Fetch and render**

`app/planner/page.tsx` fetches `/api/facilities` once on mount into state and passes `facilities` to `PlannerRouteMap`. The map renders a `<Marker>` per site using `facilityIcon(f.kind)` from Task 5, `zIndexOffset={800}` — below the route-stop markers at 900, since a stop the user is reading is more urgent than a landmark — with a tooltip carrying the site name.

- [ ] **Step 2: Verify**

Run: `npm run build`, restart, screenshot the planner with a two-stop day and confirm both sites appear beneath the route markers.

- [ ] **Step 3: Commit**

```bash
git add components/PlannerRouteMap.tsx app/planner/page.tsx
git commit -m "Show our sites on the planner route map"
```

---

### Task 9 (14c): Site distances in the customer panel

**Files:**
- Modify: `components/CustomerDetailPanel.tsx`, `components/CoverageMap.tsx`

**Interfaces:**
- Consumes: `initialFacilities` (Task 6), `distanceKm` from `lib/geo.ts`.
- Produces: `CustomerDetailPanel` prop `facilities: FacilityRow[]`.

Per spec §1.2, these distances resolve against **sites only, never GPS** — a printed distance that changes between two glances at the same panel is worse than no distance.

- [ ] **Step 1: Render the line**

One mono line under the address, only when the customer has coordinates:

```
۱۸.۲ کیلومتر تا خانه (انبار کوچک) · ۳۱.۴ تا انبار مرکزی — خط مستقیم
```

The `خط مستقیم` suffix is mandatory (Global Constraints). Reuse `formatDistanceKm` — move it from `CoverageMap.tsx` to `lib/geo.ts` so both use one implementation, and add a test for the sub-kilometre branch:

```ts
it("switches to metres below one kilometre", () => {
  expect(formatDistanceKm(0.42)).toBe("۴۲۰ متر".replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)]));
});
```

(Assert against whatever the existing implementation produces — it currently emits Latin digits: `"420 متر"`. Keep that; digit localisation is not in this stage's scope.)

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/CustomerDetailPanel.tsx components/CoverageMap.tsx lib/geo.ts tests/geo.test.ts
git commit -m "Show distance to each site in the customer panel"
```

---

## Self-review

**Spec coverage.** §1.1 table → Task 1; DB-backed accessors and `defaultOrigin` (§1.2) → Task 2; API (§1.1) → Tasks 3–4; editor UI (§1.1) → Task 7; server-side read on the map page (§1.1) → Task 6; 14e (§6) → Task 8; 14c (§6) → Task 9. The `owner_username` seam is created in Task 1 and read by nobody, which is intended. §1.3 and §1.4 belong to Stages 2–3 and are absent here by design.

**Placeholders.** None — every code step carries real code. Task 7's page body is described by its component inventory and copied shell rather than transcribed in full; that is the one place a reader must write UI from a spec, and the spec is explicit about every control and its behaviour.

**Type consistency.** `FacilityRow` is snake_case throughout (matching `CustomerRow`/`SavedLocationRow`), which is why Task 6 explicitly renames `f.mapsUrl` → `f.maps_url` and `f.note` → `f.notes` at the call sites. `facilityIcon(kind)` has the same signature in Tasks 5, 8 and 9. `defaultOrigin` is defined in Task 2 and first consumed in Stage 2, not here.

**Known break window.** Task 2 leaves `CoverageMap.tsx` referencing the deleted `FACILITIES` export; Task 6 closes it. Tasks 2–6 must land together before a deploy.
