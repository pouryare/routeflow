# Complaint Resolution Workflow — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend for a real drag-to-link resolution workflow on quality complaints —
the repurposed scope of spec §9c/§9d's generic "Cases" workflow editor, redirected onto
`/sales/complaints` (the one module that actually has an open-ended, currently-workflow-
less case-like lifecycle) instead of a brand-new generic `/sales/tasks` board.

**Architecture:** Reuses far more of the existing schema than the original spec assumed
it would need, once actually checked against this codebase rather than the video:
`tasks.entity_type`/`entity_id` (already the app's general polymorphic link, used by
photos/reminders/activity_log) ties a spawned step to its complaint — no new column on
`tasks`. `lib/repo/tasks.ts`'s existing `createTask`/`completeTask` do the task lifecycle
work already — no duplicate mutation logic. Only two new tables are genuinely needed:
`workflow_step_templates` (the fixed, seeded, app-wide step palette) and
`workflow_edges` (which task was spawned from which). An edge's solid/dashed render
state is **derived from the target task's `status` at read time**, not stored — the
original spec's draft SQL had a `state` column on the edge, which is a second place the
same fact (`is this task done`) could drift out of sync with the task's own `status`.

**Tech Stack:** `node:sqlite`, the existing `lib/repo/` layer, Vitest with this repo's
route-test convention.

**Spec:** `docs/superpowers/specs/2026-09-08-notched-skeuomorphic-substrate-design.md`
§9c/§9d name the original generic design; this plan implements the user's own repurposing
decision (2026-09-09 conversation) onto `/sales/complaints` instead — see "Decisions"
below for the full reasoning, since it materially departs from the spec's literal text.

## Global Constraints

- No new column on `tasks` — use `entity_type='complaint'` / `entity_id=<complaint id>`,
  the pattern this codebase already uses for photos/reminders/activity_log.
- No `state` column on `workflow_edges` — solid/dashed is `to_task.status === 'done'`,
  computed by the reader, never persisted redundantly.
- `workflow_step_templates` is fixed, seeded, app-wide — **no admin CRUD**, matching the
  spec's own decision 6 for the original generic design.
- `workflow_edges` and `workflow_step_templates` are children/globals, not tenant rows —
  neither gets its own `organization_id`; both must be added to
  `tests/tenancy-schema.test.ts`'s `exempt` set with a real justifying comment, the same
  discipline every existing entry there already follows.
- Completing a step reuses the existing `PATCH /api/tasks/[id]` (`completeTask`/
  `dismissTask` in `lib/repo/tasks.ts`) — no new completion endpoint.
- After any schema/route change, run the full test suite (`npm test`), not a subset.
- This repo's working directory doubles as the live `routeflow` systemd service's
  `WorkingDirectory` (port 3003). Before switching branches for the production-restore
  step, confirm `git status --porcelain -uall` is **completely** clean, not just
  `git status` — an untracked file survives a branch switch and can break the target
  branch's build. This is not optional caution; it caused a real ~90s outage earlier in
  this same body of work.

## Decisions

The spec's §9c/§9d generic design assumed a standalone `/sales/tasks` board and a
task→task edge model with no particular home. Surveying the app before writing this plan
found: RouteFlow already has three working drag-and-drop boards (`/sales/board`,
`OrderPipeline.tsx`, `AssignmentBoard.tsx`) — none of them do graph-*linking* (they move
a card between fixed columns); `/sales/complaints` is the one module shaped like the
video's open-ended "Cases" domain and today has **zero** workflow, just a status
dropdown; and `tasks` already has the generic `entity_type`/`entity_id` link this needs,
so the schema is smaller than originally planned. §17 step 6c ("task→stage assignment")
is dropped entirely — a complaint-resolution step doesn't need a `Board`-style pipeline
`stage`; its position in the *graph* already says where it is. The 6 templates are
re-labelled for complaint resolution (initial review, lab check, customer contact,
resolution, customer notification, satisfaction call) rather than the video's generic
case-management labels, but keep the same fixed-six, no-CRUD shape decision 6 already
settled.

---

### Task 1: Schema — `workflow_step_templates` + `workflow_edges`

**Files:**
- Modify: `lib/db.ts` (new migration near the end of `getDb()`, after the photos-avatar
  migration added in the previous branch; `TENANT_TABLES` is untouched — neither new
  table belongs there)
- Modify: `tests/tenancy-schema.test.ts` (add both new tables to `exempt`, with reasons)
- Test: `tests/workflow-schema.test.ts`

**Interfaces:**
- Produces (as raw tables, consumed by Task 2's repo module): `workflow_step_templates
  (id, key, label_fa, sort_order)`; `workflow_edges (id, from_task_id, to_task_id UNIQUE,
  created_at)`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// tests/workflow-schema.test.ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-workflow-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("workflow_step_templates", () => {
  it("is seeded with exactly six fixed steps", () => {
    const rows = getDb().prepare("SELECT key, label_fa FROM workflow_step_templates ORDER BY sort_order").all() as {
      key: string;
      label_fa: string;
    }[];
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.key)).toEqual([
      "initial_review",
      "lab_check",
      "customer_contact",
      "resolution",
      "customer_notify",
      "satisfaction_call",
    ]);
  });

  it("re-seeding on a second boot does not duplicate rows", () => {
    getDb(); // getDb() is memoized per test-db path, but the seed itself must be idempotent
    const n = getDb().prepare("SELECT COUNT(*) n FROM workflow_step_templates").get() as { n: number };
    expect(n.n).toBe(6);
  });
});

describe("workflow_edges", () => {
  it("links two real tasks", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO tasks (id,organization_id,kind,title,status,created_at) VALUES (901,1,'complaint_step','a','open',?)"
    ).run(now);
    db.prepare(
      "INSERT INTO tasks (id,organization_id,kind,title,status,created_at) VALUES (902,1,'complaint_step','b','open',?)"
    ).run(now);
    expect(() =>
      db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (901, 902, ?)").run(now)
    ).not.toThrow();
  });

  it("rejects a second parent for the same task -- a tree, not a general graph", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO tasks (id,organization_id,kind,title,status,created_at) VALUES (903,1,'complaint_step','c','open',?)"
    ).run(now);
    expect(() =>
      db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (901, 903, ?)").run(now)
    ).not.toThrow();
    expect(() =>
      db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (902, 903, ?)").run(now)
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/workflow-schema.test.ts`
Expected: FAIL — neither table exists yet.

- [ ] **Step 3: Add the migration**

In `lib/db.ts`, immediately before the final `_db = db; return db;`:

```typescript
  // Complaint resolution workflow (2026-09-09): a fixed, seeded, app-wide step palette
  // and a task-to-task edge table. Neither carries organization_id -- templates are
  // global (no admin CRUD, spec 2026-09-08 §15 decision 6), edges reach their tenant
  // through the tasks they connect, same as order_lines through orders. See
  // tests/tenancy-schema.test.ts's exempt set.
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_step_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      label_fa TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS workflow_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_task_id INTEGER NOT NULL REFERENCES tasks(id),
      to_task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_edges_from ON workflow_edges(from_task_id);
  `);

  const WORKFLOW_STEP_SEED: { key: string; label_fa: string; sort_order: number }[] = [
    { key: "initial_review", label_fa: "بررسی اولیه", sort_order: 1 },
    { key: "lab_check", label_fa: "آزمایش و بررسی فنی", sort_order: 2 },
    { key: "customer_contact", label_fa: "تماس با مشتری", sort_order: 3 },
    { key: "resolution", label_fa: "تعویض یا جبران", sort_order: 4 },
    { key: "customer_notify", label_fa: "اطلاع‌رسانی نتیجه", sort_order: 5 },
    { key: "satisfaction_call", label_fa: "تماس رضایت‌سنجی", sort_order: 6 },
  ];
  const insertStep = db.prepare(
    "INSERT INTO workflow_step_templates (key, label_fa, sort_order) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM workflow_step_templates WHERE key = ?)"
  );
  for (const s of WORKFLOW_STEP_SEED) insertStep.run(s.key, s.label_fa, s.sort_order, s.key);
```

- [ ] **Step 4: Update the tenancy exemption set**

In `tests/tenancy-schema.test.ts`, add to the `exempt` set (matching the existing
`"order_lines", // reaches a tenant through orders` style exactly):

```typescript
      "workflow_edges",           // reaches a tenant through the tasks it connects
      "workflow_step_templates",  // fixed, seeded, app-wide -- not tenant data
```

- [ ] **Step 5: Run the schema test, then the tenancy test, then the full suite**

Run: `npx vitest run tests/workflow-schema.test.ts tests/tenancy-schema.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS, same or higher count than the previous branch's final state
(246 test files / 1917 passed / 1 skipped).

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts tests/workflow-schema.test.ts tests/tenancy-schema.test.ts
git commit -m "feat: schema for the complaint resolution workflow (templates + edges)"
```

---

### Task 2: `lib/repo/workflow.ts` — the repo module

**Files:**
- Create: `lib/repo/workflow.ts`
- Test: `tests/repo/workflow.test.ts`

**Interfaces:**
- Consumes: `createTask` (`lib/repo/tasks.ts`, already exists — `{title, kind,
  entity_type, entity_id, created_by}`), `getDb`.
- Produces: `listStepTemplates(): StepTemplate[]`; `getComplaintSteps(organizationId,
  complaintId): { tasks: TaskRow[]; edges: { from_task_id: number; to_task_id: number }[]
  }`; `linkStep(organizationId, complaintId, templateKey, fromTaskId: number | null,
  createdByUserId: number): { taskId: number; edge: { from_task_id: number; to_task_id:
  number } | null }`. Consumed by Task 3's routes.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/repo/workflow.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-workflow-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { listStepTemplates, getComplaintSteps, linkStep } = await import("@/lib/repo/workflow");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let complaintId = 0;
let reporterId = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM workflow_edges; DELETE FROM tasks WHERE id > 0; DELETE FROM quality_complaints; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  reporterId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('rep','x','گزارش‌دهنده','salesperson',1,?,1)"
      )
      .run(now).lastInsertRowid,
  );
  complaintId = Number(
    db
      .prepare(
        "INSERT INTO quality_complaints (organization_id,reported_at,reported_by,category,severity,status,created_at) VALUES (1,?,?,?,?,?,?)"
      )
      .run(now, reporterId, "spoilage", "high", "open", now).lastInsertRowid,
  );
});

describe("listStepTemplates", () => {
  it("returns the six seeded templates in order", () => {
    const t = listStepTemplates();
    expect(t).toHaveLength(6);
    expect(t[0].key).toBe("initial_review");
  });
});

describe("linkStep / getComplaintSteps", () => {
  it("spawns a root step with no edge when fromTaskId is null", () => {
    const { taskId, edge } = linkStep(1, complaintId, "initial_review", null, reporterId);
    expect(edge).toBeNull();
    const { tasks, edges } = getComplaintSteps(1, complaintId);
    expect(tasks.map((t) => t.id)).toContain(taskId);
    expect(edges).toHaveLength(0);
    expect(tasks[0].entity_type).toBe("complaint");
    expect(tasks[0].entity_id).toBe(complaintId);
    expect(tasks[0].kind).toBe("complaint_step");
    expect(tasks[0].title).toBe("بررسی اولیه");
  });

  it("spawns a child step linked to an existing one", () => {
    const root = linkStep(1, complaintId, "initial_review", null, reporterId);
    const child = linkStep(1, complaintId, "lab_check", root.taskId, reporterId);
    expect(child.edge).toEqual({ from_task_id: root.taskId, to_task_id: child.taskId });
    const { tasks, edges } = getComplaintSteps(1, complaintId);
    expect(tasks).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it("supports branching -- two children from the same parent", () => {
    const root = linkStep(1, complaintId, "initial_review", null, reporterId);
    linkStep(1, complaintId, "lab_check", root.taskId, reporterId);
    linkStep(1, complaintId, "customer_contact", root.taskId, reporterId);
    const { edges } = getComplaintSteps(1, complaintId);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.from_task_id === root.taskId)).toBe(true);
  });

  it("rejects an unknown template key", () => {
    expect(() => linkStep(1, complaintId, "not_a_real_key", null, reporterId)).toThrow();
  });

  it("rejects linking from a task that belongs to a different complaint", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const otherComplaint = Number(
      db
        .prepare(
          "INSERT INTO quality_complaints (organization_id,reported_at,reported_by,category,severity,status,created_at) VALUES (1,?,?,?,?,?,?)"
        )
        .run(now, reporterId, "packaging", "low", "open", now).lastInsertRowid,
    );
    const otherRoot = linkStep(1, otherComplaint, "initial_review", null, reporterId);
    expect(() => linkStep(1, complaintId, "lab_check", otherRoot.taskId, reporterId)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/repo/workflow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/repo/workflow.ts
import { getDb, TaskRow } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";

export class WorkflowError extends Error {}

export interface StepTemplate {
  key: string;
  label_fa: string;
}

/** The fixed, seeded, app-wide step palette -- no admin CRUD, spec 2026-09-08 §15
 *  decision 6 (originally settled for the generic design, kept for this repurposed
 *  complaint-resolution one). */
export function listStepTemplates(): StepTemplate[] {
  return getDb()
    .prepare("SELECT key, label_fa FROM workflow_step_templates ORDER BY sort_order")
    .all() as StepTemplate[];
}

/** Every task spawned for this complaint's resolution graph, plus the edges connecting
 *  them. entity_type='complaint'/entity_id=complaintId is the same polymorphic link
 *  photos/reminders/activity_log already use -- no dedicated complaint_id column. */
export function getComplaintSteps(
  organizationId: number,
  complaintId: number,
): { tasks: TaskRow[]; edges: { from_task_id: number; to_task_id: number }[] } {
  const db = getDb();
  const tasks = db
    .prepare(
      "SELECT * FROM tasks WHERE organization_id = ? AND entity_type = 'complaint' AND entity_id = ? ORDER BY created_at"
    )
    .all(organizationId, complaintId) as TaskRow[];
  const ids = tasks.map((t) => t.id);
  const edges =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT from_task_id, to_task_id FROM workflow_edges WHERE to_task_id IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as { from_task_id: number; to_task_id: number }[]);
  return { tasks, edges };
}

/** Spawns a new task from a template, linked into the complaint's resolution graph.
 *  fromTaskId null -> a root step, attached directly to the complaint with no edge.
 *  fromTaskId set -> a child step; MUST belong to the same complaint (a resolution
 *  graph never crosses complaints), and the UNIQUE constraint on workflow_edges.
 *  to_task_id (a fresh task, by construction, can never already have a parent) makes
 *  the tree invariant a DB-level guarantee, not just an app-level one. */
export function linkStep(
  organizationId: number,
  complaintId: number,
  templateKey: string,
  fromTaskId: number | null,
  createdByUserId: number,
): { taskId: number; edge: { from_task_id: number; to_task_id: number } | null } {
  const db = getDb();
  const template = db
    .prepare("SELECT label_fa FROM workflow_step_templates WHERE key = ?")
    .get(templateKey) as { label_fa: string } | undefined;
  if (!template) throw new WorkflowError("مرحلهٔ نامعتبر");

  if (fromTaskId !== null) {
    const parent = db
      .prepare("SELECT entity_type, entity_id FROM tasks WHERE id = ? AND organization_id = ?")
      .get(fromTaskId, organizationId) as { entity_type: string | null; entity_id: number | null } | undefined;
    if (!parent || parent.entity_type !== "complaint" || parent.entity_id !== complaintId) {
      throw new WorkflowError("مرحلهٔ مبدأ متعلق به این شکایت نیست");
    }
  }

  const taskId = createTask(organizationId, {
    title: template.label_fa,
    kind: "complaint_step",
    entity_type: "complaint",
    entity_id: complaintId,
    created_by: createdByUserId,
  });

  let edge: { from_task_id: number; to_task_id: number } | null = null;
  if (fromTaskId !== null) {
    db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (?, ?, ?)").run(
      fromTaskId,
      taskId,
      new Date().toISOString(),
    );
    edge = { from_task_id: fromTaskId, to_task_id: taskId };
  }

  return { taskId, edge };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/repo/workflow.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the repo-boundary test**

Run: `npx vitest run tests/repo-boundary.test.ts`
Expected: PASS — this file lives under `lib/repo/`, so its raw SQL is sanctioned; this
step just confirms nothing else slipped outside it.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/workflow.ts tests/repo/workflow.test.ts
git commit -m "feat: lib/repo/workflow.ts -- listStepTemplates/getComplaintSteps/linkStep"
```

---

### Task 3: Routes — `GET`/`POST /api/sales/complaints/[id]/steps`

**Files:**
- Create: `app/api/sales/complaints/[id]/steps/route.ts`
- Test: `tests/api/complaint-workflow-route.test.ts`

**Interfaces:**
- Consumes: `listStepTemplates`, `getComplaintSteps`, `linkStep`, `WorkflowError`
  (`lib/repo/workflow.ts`); `complaintsRepo` (`lib/repo/complaints.ts`, to confirm the
  complaint exists and is in the caller's org before touching its steps).
- Produces: `GET` → `{ ok, templates, tasks, edges }` for roles owner/group_manager/
  salesperson (read parity with the existing complaints list route). `POST` → `{ ok,
  task_id, edge }` for roles owner/group_manager (write parity with the existing
  status-change gate, `canManage` in `ComplaintsPanel.tsx`).

- [ ] **Step 1: Write the failing route test**

```typescript
// tests/api/complaint-workflow-route.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-complaint-workflow-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/sales/complaints/[id]/steps/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

let complaintId = 0;
let owner = 0;
let salesperson = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM workflow_edges; DELETE FROM tasks WHERE id > 0; DELETE FROM quality_complaints; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  owner = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('o','x','مالک','owner',1,?,1)"
      )
      .run(now).lastInsertRowid,
  );
  salesperson = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('s','x','فروشنده','salesperson',1,?,1)"
      )
      .run(now).lastInsertRowid,
  );
  complaintId = Number(
    db
      .prepare(
        "INSERT INTO quality_complaints (organization_id,reported_at,reported_by,category,severity,status,created_at) VALUES (1,?,?,?,?,?,?)"
      )
      .run(now, salesperson, "spoilage", "high", "open", now).lastInsertRowid,
  );
});

describe("GET /api/sales/complaints/[id]/steps", () => {
  it("a salesperson can read (list parity with the complaints list route)", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      headers: { cookie: cookie(salesperson, "salesperson") },
    });
    const res = await GET(req, ctxFor(complaintId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.templates).toHaveLength(6);
    expect(json.tasks).toEqual([]);
    expect(json.edges).toEqual([]);
  });

  it("404s for a complaint id that does not exist", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/999999/steps`, {
      headers: { cookie: cookie(owner, "owner") },
    });
    const res = await GET(req, ctxFor(999999));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sales/complaints/[id]/steps", () => {
  it("an owner can spawn a root step", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      method: "POST",
      headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
      body: JSON.stringify({ template_key: "initial_review" }),
    });
    const res = await POST(req, ctxFor(complaintId));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.edge).toBeNull();
    expect(typeof json.task_id).toBe("number");
  });

  it("a salesperson cannot spawn a step (write parity with the status-change gate)", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      method: "POST",
      headers: { cookie: cookie(salesperson, "salesperson"), "content-type": "application/json" },
      body: JSON.stringify({ template_key: "initial_review" }),
    });
    const res = await POST(req, ctxFor(complaintId));
    expect(res.status).toBe(403);
  });

  it("rejects an unknown template_key with 400, not a 500", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      method: "POST",
      headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
      body: JSON.stringify({ template_key: "bogus" }),
    });
    const res = await POST(req, ctxFor(complaintId));
    expect(res.status).toBe(400);
  });

  it("chains a second step onto the first", async () => {
    const first = await POST(
      new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
        method: "POST",
        headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
        body: JSON.stringify({ template_key: "initial_review" }),
      }),
      ctxFor(complaintId),
    );
    const firstJson = await first.json();
    const second = await POST(
      new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
        method: "POST",
        headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
        body: JSON.stringify({ template_key: "lab_check", from_task_id: firstJson.task_id }),
      }),
      ctxFor(complaintId),
    );
    expect(second.status).toBe(201);
    const secondJson = await second.json();
    expect(secondJson.edge).toEqual({ from_task_id: firstJson.task_id, to_task_id: secondJson.task_id });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/complaint-workflow-route.test.ts`
Expected: FAIL — route does not exist yet.

- [ ] **Step 3: Write the route**

```typescript
// app/api/sales/complaints/[id]/steps/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { complaintsRepo } from "@/lib/repo/complaints";
import { listStepTemplates, getComplaintSteps, linkStep, WorkflowError } from "@/lib/repo/workflow";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/complaints/[id]/steps">) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const complaintId = Number(id);
  if (!Number.isInteger(complaintId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const complaint = complaintsRepo.get(guard.session.organizationId, complaintId);
  if (!complaint) return NextResponse.json({ ok: false, error: "شکایت پیدا نشد" }, { status: 404 });

  const { tasks, edges } = getComplaintSteps(guard.session.organizationId, complaintId);
  return NextResponse.json({ ok: true, templates: listStepTemplates(), tasks, edges });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/complaints/[id]/steps">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const complaintId = Number(id);
  if (!Number.isInteger(complaintId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const complaint = complaintsRepo.get(guard.session.organizationId, complaintId);
  if (!complaint) return NextResponse.json({ ok: false, error: "شکایت پیدا نشد" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { template_key?: string; from_task_id?: number } | null;
  if (!body?.template_key) {
    return NextResponse.json({ ok: false, error: "مرحله لازم است" }, { status: 400 });
  }

  try {
    const { taskId, edge } = linkStep(
      guard.session.organizationId,
      complaintId,
      body.template_key,
      body.from_task_id ?? null,
      guard.session.user.id,
    );
    return NextResponse.json({ ok: true, task_id: taskId, edge }, { status: 201 });
  } catch (e) {
    if (e instanceof WorkflowError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/complaint-workflow-route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + repo-boundary + build**

Run: `npm test`
Expected: PASS, count up from Task 1's baseline.

Run: `npm run build 2>&1 | grep -iE "warn|error"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "app/api/sales/complaints/[id]/steps/route.ts" tests/api/complaint-workflow-route.test.ts
git commit -m "feat: GET/POST /api/sales/complaints/[id]/steps"
```

---

### Task 4: MASTER.md update

**Files:**
- Modify: `MASTER.md`

- [ ] **Step 1: Document what shipped and the repurposing decision**

Update the "The workflow-editor backend..." deferred bullet: the backend is now shipped,
scoped to `/sales/complaints` rather than a new generic `/sales/tasks` board (a
2026-09-09 conversation decision — the complaints module was the one place in the app
that actually had an open-ended, currently-workflow-less case-like lifecycle; the other
three existing drag boards are all fixed-column, not graph-linking). Note the schema
simplifications versus the original spec: `entity_type`/`entity_id` reused instead of a
new column, `workflow_edges` has no `state` column (derived from `to_task.status` at
read time), `PATCH /api/tasks/[id]` reused for completion, §17 step 6c dropped as
inapplicable to a graph-shaped (rather than pipeline-shaped) workflow. Note that the UI
(the actual drag-to-link graph rendering) is a separate, following PR.

- [ ] **Step 2: Commit**

```bash
git add MASTER.md
git commit -m "docs: MASTER.md -- complaint resolution workflow backend shipped"
```

---

### Task 5: Full verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Contrast check**

Run: `node scripts/check-contrast.mjs`
Expected: unaffected (this plan adds no CSS).

- [ ] **Step 3: Full build, grep the WHOLE output**

Run: `npm run build 2>&1 | grep -iE "warn|error"`
Expected: no output.

- [ ] **Step 4: Restore the shared working directory's production build**

```bash
git status --porcelain -uall   # MUST be completely empty before switching
git checkout main
npm run build
systemctl restart routeflow
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3003/login   # expect 200
git checkout <this branch>
git status --porcelain -uall   # confirm still clean after switching back
```
