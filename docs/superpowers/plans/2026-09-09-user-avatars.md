# User Avatars — Backend + Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a real, uploadable profile picture — the substrate/kit/shell
sub-projects all lean on faces (navbar profile, avatar stacks, per-task avatars) that
`Avatar.tsx` has so far only ever rendered as initials-on-a-tone.

**Architecture:** Reuse the existing `photos` table and its `sharp`-based resize/store
pipeline (`app/api/photos/route.ts`) rather than inventing a second storage path — widen
its `entity_type` CHECK to accept `'user'`, add a partial UNIQUE index so a user has at
most one avatar row at a time, and build two small dedicated routes with their own
permission model (self-only upload, same-organization view) rather than reusing the
generic `/api/photos` routes, whose `requireRole(["owner","group_manager"])` gate and
`canReachEntity` table map are both wrong for a self-service, org-wide-visible avatar.

**Tech Stack:** Next.js Route Handlers, `node:sqlite`, `sharp` (already a dependency),
Vitest with the repo's existing temp-sqlite route-test convention
(`tests/api/deliveries-route.test.ts` is the reference).

**Spec:** `docs/superpowers/specs/2026-09-08-notched-skeuomorphic-substrate-design.md`
§9d, "Profile pictures — no schema exists".

## Global Constraints

- Reuse `PHOTOS_DIR`/`photoFilePath`/`ensurePhotosDir` from `lib/photos.ts` — no second
  storage location.
- Do **not** widen the bare `EntityType` (`lib/db.ts`) — it is also `Reminder`'s type and
  feeds `PlanEntityType`, neither of which should ever accept `'user'`. Introduce a
  separate `PhotoEntityType = EntityType | "user"` for `Photo.entity_type` only, matching
  this file's own existing pattern for `PlanEntityType`.
- Do **not** touch `/api/photos/*` (the customer/district gallery routes) — new, separate
  routes under `/api/users/[id]/avatar`.
- Self-service only for v1: a user can upload/remove only their own avatar. No
  admin-uploads-for-others path — matches the minimalism the workflow-template decision
  already set (§15 decision 6, "no admin CRUD").
- The spec's "assign realistic AI-generated avatars to demo users" seed-script idea is
  **out of scope for this plan** — it needs real image assets nobody has produced yet.
  This plan builds the pipe; filling it with demo images is separate work.
- After any schema/route change, run the full test suite, not a subset — `npm test`.
- Deployment is `npm run build` + `systemctl restart routeflow`, done from this same
  working directory as the live service — see the note in the previous branch about
  restoring `main` after every verification build in this shared directory.

---

### Task 1: Schema — widen `photos` for user avatars

**Files:**
- Modify: `lib/db.ts` (the `photos` CHECK migration, near the end of `getDb()`,
  `lib/db.ts:3095`-ish, right before `_db = db; return db;`; the `EntityType`/`Photo`
  type block, `lib/db.ts:3155`-3199)
- Test: `tests/avatar-schema.test.ts`

**Interfaces:**
- Produces: `PhotoEntityType = EntityType | "user"` (new export), `Photo.entity_type:
  PhotoEntityType` (changed from `EntityType`). `EntityType` itself is untouched.

- [ ] **Step 1: Write the failing schema test**

```typescript
// tests/avatar-schema.test.ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-avatar-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("photos table accepts 'user' avatars", () => {
  it("accepts entity_type='user'", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('user',1,?,?,?)"
        )
        .run(`stem-${Math.random()}`, now, now)
    ).not.toThrow();
  });

  it("still rejects a bogus entity_type", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('bogus',1,?,?,?)"
        )
        .run(`stem-${Math.random()}`, now, now)
    ).toThrow();
  });

  it("allows only one 'user' photo row per entity_id", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('user',2,?,?,?)"
    ).run(`stem-a-${Math.random()}`, now, now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('user',2,?,?,?)"
        )
        .run(`stem-b-${Math.random()}`, now, now)
    ).toThrow();
  });

  it("does not constrain a non-user entity_id the same way -- customers can have many photos", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('customer',9,?,?,?)"
    ).run(`stem-c1-${Math.random()}`, now, now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('customer',9,?,?,?)"
        )
        .run(`stem-c2-${Math.random()}`, now, now)
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/avatar-schema.test.ts`
Expected: FAIL — the live `photos` CHECK is still `entity_type IN ('district',
'customer')`, so the first test's INSERT throws.

- [ ] **Step 3: Add the migration**

In `lib/db.ts`, immediately before the final `_db = db; return db;` (right after the
`backfillReminderTasks(db);` call at the end of `getDb()`), add:

```typescript
  // User avatars (2026-09-09): widen photos' entity_type CHECK to accept 'user',
  // reusing the existing storage/upload pipeline rather than a second one. SQLite
  // cannot ALTER a CHECK constraint in place -- same rebuild-and-rename idiom as
  // rebuildOrdersStatusMachine / the saved_locations resolution widening above.
  const photosSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='photos'")
    .get() as { sql: string } | undefined;
  if (photosSchema && !photosSchema.sql.includes("'user'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE photos_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'user')),
          entity_id INTEGER NOT NULL,
          file_stem TEXT UNIQUE NOT NULL,
          caption TEXT,
          taken_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO photos_new SELECT * FROM photos;
        DROP TABLE photos;
        ALTER TABLE photos_new RENAME TO photos;
        CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id, taken_at);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  // A user has at most one avatar row at a time -- upload replaces rather than
  // accumulates (unlike a customer's photo gallery, which is meant to grow). The app
  // layer (Task 2) also deletes-then-inserts inside one transaction; this index is the
  // real guarantee against a race between two concurrent uploads for the same user.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_user_singleton
       ON photos(entity_id) WHERE entity_type = 'user'`
  );
```

- [ ] **Step 4: Widen the `Photo` type, not the bare `EntityType`**

In `lib/db.ts`, near the existing `PlanEntityType`/`LoggableEntityType` block
(`lib/db.ts:3155`-3164):

```typescript
export type EntityType = "district" | "customer";
export type PlanEntityType = EntityType | "facility";
export type LoggableEntityType = PlanEntityType;
export const PLAN_ENTITY_TYPES: PlanEntityType[] = ["district", "customer", "facility"];
/** Widens EntityType for the photos table alone -- a user avatar is a photo, but it is
   never a plan entity or an activity-log subject, so this does NOT fold into
   PlanEntityType/LoggableEntityType the way "facility" does. */
export type PhotoEntityType = EntityType | "user";
```

Then change the `Photo` interface (`lib/db.ts:3191`-3199)'s `entity_type` field from
`EntityType` to `PhotoEntityType`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/avatar-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite — this migration touches every test's DB**

Run: `npm test`
Expected: PASS, same or higher count than before this task. A CHECK-widening + new
index migration runs on every fresh test DB (each test file builds its own temp
sqlite file via `getDb()`), so this is the step most likely to surface a collision —
run the whole suite, not just the new file.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts tests/avatar-schema.test.ts
git commit -m "feat: widen photos for user avatars (schema only)"
```

---

### Task 2: Org-view permission — pure logic

**Files:**
- Create: `lib/avatarAccess.ts`
- Create: `tests/avatarAccess.test.ts`

**Interfaces:**
- Produces: `canViewUserAvatar(viewer: { role: Role; organizationId: number },
  targetOrgId: number): boolean`. Consumed by Task 4's GET route.

Upload permission (self-only) is a one-line equality check folded directly into Task 3's
route — not worth its own module. View permission has a real branch (platform_owner
bypass) worth pinning with a test, the same judgment call this codebase already makes for
`canReachOrg`/`canReachGroup` in `lib/session.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/avatarAccess.test.ts
import { describe, expect, it } from "vitest";
import { canViewUserAvatar } from "@/lib/avatarAccess";

describe("canViewUserAvatar", () => {
  it("allows viewing within the same organization, any non-platform role", () => {
    expect(canViewUserAvatar({ role: "salesperson", organizationId: 1 }, 1)).toBe(true);
    expect(canViewUserAvatar({ role: "owner", organizationId: 1 }, 1)).toBe(true);
  });

  it("denies viewing across organizations for an ordinary role", () => {
    expect(canViewUserAvatar({ role: "owner", organizationId: 1 }, 2)).toBe(false);
    expect(canViewUserAvatar({ role: "driver", organizationId: 1 }, 2)).toBe(false);
  });

  it("a platform_owner may view any organization's avatar", () => {
    expect(canViewUserAvatar({ role: "platform_owner", organizationId: 1 }, 2)).toBe(true);
    expect(canViewUserAvatar({ role: "platform_owner", organizationId: 1 }, 999)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/avatarAccess.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/avatarAccess.ts
import type { Role } from "./roles";

/** Whether `viewer` may see the avatar image of a user belonging to `targetOrgId`.
 *
 *  Avatars are visible ORG-WIDE, not group-scoped like canReachUser in lib/session.ts --
 *  a shared task board or notification list needs to show a colleague's face regardless
 *  of which group that colleague is in, which canReachUser's stricter rule (salesperson/
 *  driver reach only themselves) would wrongly block. The tenant boundary is still real:
 *  a platform_owner may cross it, nobody else may. */
export function canViewUserAvatar(
  viewer: { role: Role; organizationId: number },
  targetOrgId: number,
): boolean {
  if (viewer.role === "platform_owner") return true;
  return viewer.organizationId === targetOrgId;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/avatarAccess.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/avatarAccess.ts tests/avatarAccess.test.ts
git commit -m "feat: canViewUserAvatar -- org-wide avatar visibility, tenant-safe"
```

---

### Task 3: Upload + remove — `POST`/`DELETE /api/users/[id]/avatar`

**Files:**
- Create: `app/api/users/[id]/avatar/route.ts`
- Test: `tests/api/user-avatar-route.test.ts` (this task's tests only cover POST/DELETE;
  Task 4 adds the GET-file tests to the same file)

**Interfaces:**
- Consumes: `getSession` (`lib/session.ts`), `ensurePhotosDir`/`photoFilePath`
  (`lib/photos.ts`), `getDb`/`Photo` (`lib/db.ts`).
- Produces: `POST /api/users/[id]/avatar` (multipart `file` field) →
  `{ ok: true, id, file_stem }` on success; `DELETE /api/users/[id]/avatar` →
  `{ ok: true }`. Both self-only: `id` must equal the caller's own `session.user.id`.

- [ ] **Step 1: Write the failing route test**

```typescript
// tests/api/user-avatar-route.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-avatar-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { PHOTOS_DIR } = await import("@/lib/photos");
const { POST, DELETE } = await import("@/app/api/users/[id]/avatar/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true });
});

let me = 0;
let other = 0;

function cookie(uid: number, role: string, oid = 1) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}
// A minimal valid 1x1 PNG -- real bytes, small enough to inline, real enough for sharp
// to decode without a fixture file.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM photos; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,?)"
  );
  me = Number(insert.run("me", "x", "من", "salesperson", now, 1).lastInsertRowid);
  other = Number(insert.run("other", "x", "دیگری", "salesperson", now, 1).lastInsertRowid);
});

function uploadReq(uid: number, targetId: number, file?: Buffer) {
  const fd = new FormData();
  if (file) fd.append("file", new File([new Uint8Array(file)], "a.png", { type: "image/png" }));
  return new NextRequest(`http://x/api/users/${targetId}/avatar`, {
    method: "POST",
    headers: { cookie: cookie(uid, "salesperson") },
    body: fd,
  });
}

describe("POST /api/users/[id]/avatar", () => {
  it("uploads your own avatar", async () => {
    const res = await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const row = getDb().prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?").get(me);
    expect(row).toBeTruthy();
  });

  it("rejects uploading to someone else's avatar", async () => {
    const res = await POST(uploadReq(me, other, PNG_1PX), ctxFor(other));
    expect(res.status).toBe(403);
    const row = getDb().prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?").get(other);
    expect(row).toBeFalsy();
  });

  it("rejects a non-image file", async () => {
    const res = await POST(uploadReq(me, me, Buffer.from("not an image")), ctxFor(me));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("replaces the previous avatar instead of accumulating rows", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const first = getDb().prepare("SELECT id FROM photos WHERE entity_type='user' AND entity_id=?").get(me) as { id: number };
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const rows = getDb().prepare("SELECT id FROM photos WHERE entity_type='user' AND entity_id=?").all(me) as { id: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(first.id);
  });
});

describe("DELETE /api/users/[id]/avatar", () => {
  it("removes your own avatar", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar`, {
      method: "DELETE",
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await DELETE(req, ctxFor(me));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?").get(me);
    expect(row).toBeFalsy();
  });

  it("is a harmless no-op when there is nothing to delete", async () => {
    const req = new NextRequest(`http://x/api/users/${me}/avatar`, {
      method: "DELETE",
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await DELETE(req, ctxFor(me));
    expect(res.status).toBe(200);
  });

  it("rejects deleting someone else's avatar", async () => {
    const req = new NextRequest(`http://x/api/users/${other}/avatar`, {
      method: "DELETE",
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await DELETE(req, ctxFor(other));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/user-avatar-route.test.ts`
Expected: FAIL — `app/api/users/[id]/avatar/route.ts` does not exist yet.

- [ ] **Step 3: Write the route**

```typescript
// app/api/users/[id]/avatar/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import sharp from "sharp";
import { getDb, Photo } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ensurePhotosDir, photoFilePath } from "@/lib/photos";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // a phone selfie, not a DSLR RAW

/** Self-only: no admin-uploads-for-others path in v1 (matches the workflow-template
 *  decision's "no admin CRUD" minimalism, spec §15 decision 6). */
function guardSelf(req: NextRequest, targetId: number) {
  const session = getSession(req);
  if (!session) return { ok: false as const, response: NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 }) };
  if (session.user.id !== targetId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "فقط تصویر پروفایل خودتان" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/users/[id]/avatar">) {
  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const guard = guardSelf(req, targetId);
  if (!guard.ok) return guard.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۸ مگابایت باشد" }, { status: 413 });
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const stem = crypto.randomUUID();

  let avifBuffer: Buffer;
  let webpBuffer: Buffer;
  try {
    // "attention"-cropped to 512x512: an avatar is always shown square/circular, so
    // fit:"cover" (not the gallery pipeline's fit:"inside") -- and "attention" biases
    // the crop toward the most visually interesting region, which is usually a face.
    const pipeline = sharp(inputBuffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: "cover", position: "attention" });
    [avifBuffer, webpBuffer] = await Promise.all([
      pipeline.clone().avif({ quality: 60 }).toBuffer(),
      pipeline.clone().webp({ quality: 78 }).toBuffer(),
    ]);
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }

  ensurePhotosDir();
  await fs.writeFile(photoFilePath(stem, "avif"), avifBuffer);
  await fs.writeFile(photoFilePath(stem, "webp"), webpBuffer);

  const db = getDb();
  const now = new Date().toISOString();
  const prior = db
    .prepare("SELECT file_stem FROM photos WHERE entity_type='user' AND entity_id=?")
    .get(targetId) as { file_stem: string } | undefined;

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM photos WHERE entity_type='user' AND entity_id=?").run(targetId);
    var result = db
      .prepare(
        "INSERT INTO photos (entity_type, entity_id, file_stem, taken_at, created_at) VALUES ('user', ?, ?, ?, ?)"
      )
      .run(targetId, stem, now, now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  // Best-effort cleanup of the file this row replaced -- never lets a storage-cleanup
  // failure fail the request that already succeeded in the database.
  if (prior) {
    await Promise.all([
      fs.unlink(photoFilePath(prior.file_stem, "avif")).catch(() => {}),
      fs.unlink(photoFilePath(prior.file_stem, "webp")).catch(() => {}),
    ]);
  }

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid), file_stem: stem });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/users/[id]/avatar">) {
  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const guard = guardSelf(req, targetId);
  if (!guard.ok) return guard.response;

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?")
    .get(targetId) as Photo | undefined;
  if (!row) return NextResponse.json({ ok: true }); // nothing to delete -- harmless no-op

  db.prepare("DELETE FROM photos WHERE id = ?").run(row.id);
  await Promise.all([
    fs.unlink(photoFilePath(row.file_stem, "avif")).catch(() => {}),
    fs.unlink(photoFilePath(row.file_stem, "webp")).catch(() => {}),
  ]);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/user-avatar-route.test.ts`
Expected: PASS (7 tests). If the "replaces the previous avatar" test fails on a UNIQUE
constraint error instead of passing, the delete-then-insert transaction in Step 3 is not
actually running before the insert — check the `BEGIN`/`COMMIT` block is wrapping both
statements, not just the insert.

- [ ] **Step 5: Commit**

```bash
git add app/api/users/\[id\]/avatar/route.ts tests/api/user-avatar-route.test.ts
git commit -m "feat: POST/DELETE /api/users/[id]/avatar -- self-only upload and remove"
```

---

### Task 4: Serve the file — `GET /api/users/[id]/avatar/file`

**Files:**
- Create: `app/api/users/[id]/avatar/file/route.ts`
- Modify: `tests/api/user-avatar-route.test.ts` (add the GET tests to the same file)

**Interfaces:**
- Consumes: `canViewUserAvatar` (Task 2), `getSession`, `getDb`.
- Produces: `GET /api/users/[id]/avatar/file?format=avif|webp` → image bytes (200) or
  404 (no avatar, or same reasons a 404 already covers elsewhere: not found means either
  "does not exist" or "you may not see it," never distinguished, matching
  `/api/photos/[id]/file`'s own convention).

- [ ] **Step 1: Add the failing GET tests**

Append to `tests/api/user-avatar-route.test.ts`:

```typescript
const { GET } = await import("@/app/api/users/[id]/avatar/file/route");

describe("GET /api/users/[id]/avatar/file", () => {
  it("serves the uploaded avatar", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file`, {
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("serves avif when asked", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file?format=avif`, {
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.headers.get("Content-Type")).toBe("image/avif");
  });

  it("404s when the user has no avatar", async () => {
    const req = new NextRequest(`http://x/api/users/${other}/avatar/file`, {
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await GET(req, ctxFor(other));
    expect(res.status).toBe(404);
  });

  it("a colleague in the same organization can view it", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file`, {
      headers: { cookie: cookie(other, "salesperson") },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.status).toBe(200);
  });

  it("a different organization cannot view it", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const otherOrgUser = Number(
      db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('crossorg','x','x','owner',1,?,2)"
        )
        .run(now).lastInsertRowid,
    );
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file`, {
      headers: { cookie: cookie(otherOrgUser, "owner", 2) },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/user-avatar-route.test.ts`
Expected: FAIL — the file route does not exist yet. (The cross-org test needs
`organizations` row id=2 to exist for the FK, or the users insert to succeed regardless —
if the `organization_id` FK is enforced and org 2 does not exist in a fresh test DB,
insert an `organizations` row for id 2 first in that test, mirroring however other
cross-tenant tests in this repo seed a second organization — check
`tests/tenancy-schema.test.ts` or `tests/tenancy-writers.test.ts` for the exact seed
shape used elsewhere before assuming a bare INSERT works.)

- [ ] **Step 3: Write the route**

```typescript
// app/api/users/[id]/avatar/file/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getDb, Photo, UserRow } from "@/lib/db";
import { getSession } from "@/lib/session";
import { photoFilePath } from "@/lib/photos";
import { canViewUserAvatar } from "@/lib/avatarAccess";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/users/[id]/avatar/file">) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });

  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }

  const db = getDb();
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as UserRow | undefined;
  if (!target || !canViewUserAvatar(session, target.organization_id)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const row = db
    .prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?")
    .get(targetId) as Photo | undefined;
  if (!row) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "avif" ? "avif" : "webp";
  try {
    const buffer = await fs.readFile(photoFilePath(row.file_stem, format));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": format === "avif" ? "image/avif" : "image/webp",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر پیدا نشد" }, { status: 404 });
  }
}
```

`Cache-Control` is a much shorter 1 hour, not the gallery route's `immutable` year: an
avatar is expected to change (that is the whole point of this plan), while a customer
photo essentially never does once taken.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/user-avatar-route.test.ts`
Expected: PASS (12 tests total across both describe blocks in this file).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, count up by 12 (or however many net-new assertions Tasks 1-4 added)
from Task 1's post-migration baseline.

- [ ] **Step 6: Commit**

```bash
git add app/api/users/\[id\]/avatar/file/route.ts tests/api/user-avatar-route.test.ts
git commit -m "feat: GET /api/users/[id]/avatar/file -- org-wide, tenant-safe avatar serving"
```

---

### Task 5: Wire `Avatar.tsx` to render a real picture when one exists

**Files:**
- Modify: `components/kargah/Avatar.tsx`

**Interfaces:**
- No prop signature change: existing callers (ProfileMenu, AvatarStack, task rows, the
  Rail nowhere touches this, etc.) keep passing `userId`/`name`/`size`/`title`/`count`
  exactly as today. This is the whole reason avatar visibility was designed as an
  always-attempted `<img>` with a graceful fallback (Task 4's file route 404s cleanly
  for a user with none) rather than a new prop every call site would need threading
  through — there is no cheap way to know "does this user have an avatar" without
  either a fetch per avatar or a join at every one of Avatar's ~dozen call sites, and
  the fetch/onError approach costs nothing when the file route 404s (one cached 404,
  same as any missing image the browser already handles for free).

- [ ] **Step 1: Add the `<img>` path with a fallback**

`Avatar.tsx` currently has no `"use client"` directive because it is pure/stateless.
Rendering an image that can fail needs local state for the fallback, so this task adds
one.

```tsx
// components/kargah/Avatar.tsx -- add at the top:
"use client";

import { useState } from "react";
```

Change the component so the chip becomes a fallback rather than the only path:

```tsx
export default function Avatar({
  userId,
  name,
  size = 28,
  title,
  count,
  className = "",
}: {
  userId?: number;
  name: string;
  size?: number;
  title?: string;
  count?: number;
  className?: string;
}) {
  const tone = toneFor(userId ?? name);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(userId) && !imgFailed;

  const chip = showImg ? (
    <img
      src={`/api/users/${userId}/avatar/file`}
      alt={title ?? name}
      title={title ?? name}
      className={`av ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: "35%",
        objectFit: "cover",
        display: "inline-block",
        flex: "none",
      }}
      onError={() => setImgFailed(true)}
    />
  ) : (
    <span
      aria-hidden="true"
      title={title ?? name}
      className={`av ${className}`.trim()}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        borderRadius: "35%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        fontWeight: 600,
        lineHeight: 1,
        background: `var(--${tone}-soft)`,
        color: `var(--${tone})`,
      }}
    >
      {initials(name)}
    </span>
  );
  if (!count) return chip;
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      {chip}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          insetInlineEnd: -4,
          bottom: -4,
          minWidth: 14,
          padding: "0 3px",
          borderRadius: 999,
          border: "1px solid var(--surface)",
          background: `var(--${tone})`,
          color: "var(--surface)",
          fontFamily: "var(--font-num)",
          fontSize: Math.max(9, Math.round(size * 0.3)),
          lineHeight: "14px",
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        {faNum(count)}
      </span>
    </span>
  );
}
```

Update the doc comment at the top of the file: it currently says "The users table has
display names and no images, so this is initials on a coloured ground" — that premise is
now false. Replace with something like: "Tries a real avatar first
(`/api/users/{id}/avatar/file`), falling through to initials-on-a-tone on a 404/error --
still honest about what the system actually has for a user with no picture, just no
longer assuming nobody ever will."

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build. `Avatar.tsx` becoming a client component is a leaf-node change —
every existing consumer (a mix of server and client components) can render a client
component as a child with no boundary change of its own.

- [ ] **Step 3: Commit**

```bash
git add components/kargah/Avatar.tsx
git commit -m "feat: Avatar.tsx renders a real picture when one exists, falls back to initials"
```

---

### Task 6: Upload/remove UI in `ProfileMenu`

**Files:**
- Modify: `components/kargah/ProfileMenu.tsx`
- Modify: `app/globals.css` (small addition for the upload affordance)

**Interfaces:**
- Consumes: `useToast` (`components/ToastProvider.tsx`), the Task 3 routes.

Mirrors `PhotoGallery.tsx`'s established upload idiom exactly: a `<label>` wrapping a
hidden file input, upload-on-select (no separate save step), toast feedback.

- [ ] **Step 1: Add the uploader to `pm__who`**

In `components/kargah/ProfileMenu.tsx`, add the imports:

```tsx
import { useRef, useState } from "react"; // useState/useRef already imported -- extend, don't duplicate
import { useToast } from "@/components/ToastProvider";
```

Add local state and handlers inside the component, alongside the existing `open`/`root`
state:

```tsx
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarNonce, setAvatarNonce] = useState(0); // bumps the <img> src to bust cache after a change

  async function handleAvatarFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/users/${userId}/avatar`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "خطا در آپلود تصویر");
      }
      toast("تصویر پروفایل به‌روزرسانی شد.", "success");
      setAvatarNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در آپلود تصویر", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAvatar() {
    try {
      const res = await fetch(`/api/users/${userId}/avatar`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("تصویر پروفایل حذف شد.", "info");
      setAvatarNonce((n) => n + 1);
    } catch {
      toast("خطا در حذف تصویر", "error");
    }
  }
```

Replace the `pm__who` block's `<Avatar userId={userId} name={name} size={38} />` with a
version wrapped in the upload affordance, keyed on `avatarNonce` so a fresh upload
actually replaces the cached broken/old image rather than an `Avatar` instance that
already resolved `imgFailed=true` before the upload happened:

```tsx
          <div className="pm__who">
            <label className="pm__avatarLabel" title="تغییر تصویر پروفایل">
              <Avatar key={avatarNonce} userId={userId} name={name} size={38} />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarFile(f);
                }}
              />
            </label>
            <div>
              <div className="pm__name">{name}</div>
              <div className="pm__role">{roleLabel}</div>
            </div>
          </div>
          <button
            type="button"
            className="pm__link"
            style={{ textAlign: "start", width: "100%", border: 0 }}
            disabled={uploading}
            onClick={removeAvatar}
          >
            حذف تصویر پروفایل
          </button>
```

- [ ] **Step 2: Add the tiny affordance CSS**

Append near `.pm__who` in `app/globals.css`:

```css
.pm__avatarLabel { cursor: pointer; display: inline-flex; border-radius: 35%; }
.pm__avatarLabel:hover { opacity: 0.85; }
.pm__avatarLabel input { display: none; }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add components/kargah/ProfileMenu.tsx app/globals.css
git commit -m "feat: upload/remove your own avatar from ProfileMenu"
```

---

### Task 7: MASTER.md update

**Files:**
- Modify: `MASTER.md`

- [ ] **Step 1: Update the §9d deferred bullet**

Find the "The workflow-editor backend..." deferred bullet (added by the shell
sub-project's Task 12) and the icon-set bullet's neighbourhood; add a note that user
avatars — the OTHER §9d gap — are done: schema widened, self-only upload/remove routes,
org-wide tenant-safe viewing, `Avatar.tsx` wired with a real-picture-first/
initials-fallback path, no other call site changed. Only the workflow-editor backend
(`workflow_edges`/`workflow_step_templates`/instantiation) remains from §9d.

- [ ] **Step 2: Commit**

```bash
git add MASTER.md
git commit -m "docs: MASTER.md -- user avatars shipped, only the workflow backend remains from §9d"
```

---

### Task 8: Full verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Contrast check**

Run: `node scripts/check-contrast.mjs`
Expected: unaffected, still passes -- this plan adds no new color tokens.

- [ ] **Step 3: Full build, grep the WHOLE output**

Run: `npm run build 2>&1 | grep -iE "warn|error"`
Expected: no output.

- [ ] **Step 4: Restore the shared working directory's production build**

This repo's working directory doubles as the live `routeflow` systemd service's
`WorkingDirectory`. After Step 3's build leaves `.next` on this feature branch, switch
to `main`, rebuild, and restart the service before finishing -- the same discipline
adopted partway through the previous branch, now the default for the rest of this
working session:

```bash
git checkout main
npm run build
systemctl restart routeflow
git checkout <this branch>
```

- [ ] **Step 5: Manual smoke check**

Since `Avatar.tsx`'s new render path has no automated coverage (no jsdom/testing-library
in this repo, matching its existing convention for browser-only glue), open
`/sales/today` in a real browser, open the profile menu, upload a real photo, confirm it
appears immediately and survives a page reload, then remove it and confirm it falls back
to initials.
