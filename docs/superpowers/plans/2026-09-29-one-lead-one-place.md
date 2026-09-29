# One Lead, One Place: Finishing the Pin→Customer Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run the pin→customer fold on every boot instead of once, guarded so it can never delete a row a live run stop points at — which makes `/leads` and `/crm` stop being able to permanently disagree about where a lead lives.

**Architecture:** One function, two changes. `foldLeadPinsIntoCustomers` gains a `NOT EXISTS` clause in its existing `SELECT` — the mandatory precondition, because `lead_run_stops.location_id` is `ON DELETE CASCADE` and the fold issues a hand-written `DELETE FROM saved_locations`, so promoting a pin currently destroys the stop that points at it. And the one-shot `app_meta` marker at boot is dropped, because the fold's predicate is "a pin that is in a lead list" — a fact about *rows*, not about *time*, and a one-shot guard makes it time-dependent. The fold is already idempotent, so running it on every boot costs nothing.

**Tech Stack:** `node:sqlite` via `lib/db.ts`, Vitest. **No UI work** beyond one string in `lib/pageMeta.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-one-lead-one-place-design.md`

**Runs after:** plan 1 and plan 2. Spec 1 changes what `/leads` *is*; this spec changes what it *holds*. Doing this first means redoing the framing.

---

## The hazard, stated before anything else

**The dangerous part of this change is not the data. It is the `DELETE`.**

`lead_run_stops` carries `location_id INTEGER NOT NULL REFERENCES saved_locations(id) ON DELETE CASCADE` (schema, `lib/db.ts:1029`), and the fold issues `DELETE FROM saved_locations WHERE id = ?` (`lib/db.ts:664`). So promoting a pin deletes the row its run stop points at, and the cascade takes the stop with it — **silently, and correctly, by the database's own definition of a cascade.**

**This is not a question of how many rows are affected.** On a dev database it is a handful. On a real one the count is different and unknowable in advance — zero, or every run in the business. **The guard therefore has to be unconditional, because the exposure cannot be measured.**

That is also why the naive reading of the spec — "just drop the marker and re-run it" — is wrong, and it is why the test in Task 1 asserts that **the stop survives**, not merely that the pin was skipped. Asserting the skip alone would pass even if the delete still happened.

---

## The shape of the code, before any task

| File | Responsibility | Task |
|---|---|---|
| `lib/db.ts:632-670` | `foldLeadPinsIntoCustomers`. Gains the precondition and reports what it skipped. | 1, 2 |
| `lib/db.ts:3071-3081` | The one-shot `app_meta` marker. Dropped. | 2 |
| `lib/pageMeta.ts:31-35` | `/leads`'s overview, which describes pins as "not yet leads". | 3 |
| `tests/lead-pin-foldin.test.ts` | Extended with the three cases the spec names. | 1, 2 |
| `tests/no-one-shot-data-migration.test.ts` | **NEW.** A data-dependent migration may not be one-shot. | 4 |
| `tests/no-cascade-migration.test.ts` | **NEW.** No migration may `DELETE` from a table a live FK points at, unguarded. | 5 |


---

### Task 1: The precondition — never destroy a run stop

**Files:**
- Modify: `lib/db.ts:632-670` (`foldLeadPinsIntoCustomers`)
- Modify: `tests/lead-pin-foldin.test.ts` (add the two cases the spec names)

**Why this task comes first, alone.** It is the guard. The re-run in Task 2 is what makes the guard *necessary*; if the re-run landed first, the next boot would silently delete run stops. Doing the guard first means there is no window in which the dangerous state exists.

- [ ] **Step 1: Write the failing tests**

In `tests/lead-pin-foldin.test.ts`, add a seed helper near the top of the file, after the existing imports:

```ts
/* Seeds a pin that is BOTH in a lead list and on a lead run, and a lead run to hold
   the stop. This is the shape that makes the fold dangerous.
   If lead_run_stops turns out to need more NOT NULL columns, read the schema at
   lib/db.ts:1026-1032 and fill them in -- the point is the RELATIONSHIP, not the
   column list. */
function seedPinOnRun() {
  const db = getDb();
  db.exec(`INSERT INTO lead_runs (id, driver_user_id, run_date, status, planned_by, organization_id, created_at, updated_at)
           VALUES (500, 1, '2026-01-01', 'planned', 1, 3, '2026-01-01', '2026-01-01')`);
  db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
           VALUES (910, 'پین روی مسیر', 'https://maps.example/z', 'manual', 30, '2026-01-01', '2026-01-01', 3)`);
  db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 910, 0, '2026-01-01')`);
  db.exec(`INSERT INTO lead_run_stops (run_id, location_id, sort_order, organization_id, created_at)
           VALUES (500, 910, 0, 3, '2026-01-01')`);
  return db;
}
```

Then add two `it` blocks inside the existing `describe`:

```ts
  it("skips a pin that has a run stop, and the stop SURVIVES", () => {
    /* The assertion that matters is the second one.
     *
     * lead_run_stops.location_id is `REFERENCES saved_locations(id) ON DELETE CASCADE`,
     * and the fold issues a hand-written `DELETE FROM saved_locations WHERE id = ?`. So
     * promoting a pin on a live run deletes the pin, the cascade takes the stop with it,
     * and the database considers the whole thing correct. A driver's assigned work — a
     * promise the office made this morning — would be gone, silently.
     *
     * Asserting only that the pin was SKIPPED would pass even if the delete still
     * happened, because the two are the same statement. So the stop is read afterwards. */
    const db = seedPinOnRun();

    const result = foldLeadPinsIntoCustomers(db);

    expect(
      db.prepare("SELECT 1 FROM customers WHERE customer_code='LEAD-910'").get(),
    ).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=910").get()).toBeTruthy();

    // And, the part that actually matters: the stop is still there.
    expect(
      db.prepare("SELECT 1 FROM lead_run_stops WHERE location_id=910").get(),
      "the fold must never cascade a run stop",
    ).toBeTruthy();

    // And the behaviour is visible rather than silent — the spec's §5.1.
    expect(result.skipped).toContain(910);
  });

  it("promotes the pin once its run is done", () => {
    /* The migration is eventually consistent with the runs, not destructive to them: the
     * pin waits for the run to finish, and a later boot picks it up. Re-running is safe,
     * which is what makes that true. */
    const db = seedPinOnRun();
    foldLeadPinsIntoCustomers(db);
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=910").get()).toBeTruthy();

    // The driver finishes the day.
    db.exec(`UPDATE lead_runs SET status='done' WHERE id=500`);

    foldLeadPinsIntoCustomers(db);

    expect(
      db.prepare("SELECT customer_code, lifecycle FROM customers WHERE customer_code='LEAD-910'").get(),
    ).toMatchObject({ customer_code: "LEAD-910", lifecycle: "lead" });
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=910").get()).toBeUndefined();

- [ ] **Step 3: Add the precondition to the fold's `SELECT`**

In `lib/db.ts`, replace the `SELECT` inside `foldLeadPinsIntoCustomers` (currently lines 634-638):

BEFORE:
```ts
  const pins = db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.address, s.lat, s.lng, s.notes, s.group_id, s.organization_id
         FROM saved_locations s
         JOIN lead_list_items i ON i.location_id = s.id`
    )
```

AFTER:
```ts
  /* NOT EXISTS is the whole precondition, and it is unconditional.
   *
   * lead_run_stops.location_id is `REFERENCES saved_locations(id) ON DELETE CASCADE`
   * (schema), and the loop below issues a hand-written `DELETE FROM saved_locations`.
   * So promoting a pin that is on a run would delete the pin, the cascade would take the
   * stop with it, and SQLite would call the whole transaction correct. A driver's
   * assigned work — a promise the office made that morning — gone, silently.
   *
   * The count of affected rows cannot be measured in advance: on a dev database it is a
   * handful, on a real one it is zero or every run in the business. So the guard does not
   * depend on the count.
   *
   * A finished run releases its leads — that is the same `status != 'done'` rule
   * readLeadRunAssignments reasons about — so the pin is promoted on a later boot rather
   * than never. The migration is eventually consistent with the runs, not destructive to
   * them. */
  const pins = db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.address, s.lat, s.lng, s.notes, s.group_id, s.organization_id
         FROM saved_locations s
         JOIN lead_list_items i ON i.location_id = s.id
        WHERE NOT EXISTS (SELECT 1 FROM lead_run_stops st WHERE st.location_id = s.id)`
    )
```

**The `DELETE` loop is unchanged.** It is now unreachable for a pin on a run, because such a pin is not in `pins` at all. The precondition is in the *read*, not in a guard around the write, so there is no window between "checked" and "deleted".

- [ ] **Step 4: Make the function report what it skipped**

Replace the function's signature:

BEFORE:
```ts
export function foldLeadPinsIntoCustomers(db: DatabaseSync): void {
```

AFTER:
```ts
/** What one pass of the fold did. Returned, not merely logged, because the whole failure
 *  mode of this migration is silence: a pin silently not promoted, a stop silently
 *  destroyed. A test can assert a return value; it cannot assert a log line. */
export interface LeadPinFoldResult {
  /** Pins promoted to `customers` and deleted from `saved_locations`. */
  promoted: number[];
  /** Pins left alone because a `lead_run_stops` row points at them. */
  skipped: number[];
}

export function foldLeadPinsIntoCustomers(db: DatabaseSync): LeadPinFoldResult {
```

Replace the early-out:

BEFORE:
```ts
  if (pins.length === 0) return;
```

AFTER:
```ts
  /* Every pin that is in a list AND on a run. Counted before the loop so the number
   * reported is the number DECLINED, not merely what is left over — a skipped pin is
   * still a pin, and the operator is the one who needs to hear about it. */
  const skipped = (
    db
      .prepare(
        `SELECT s.id FROM saved_locations s
           JOIN lead_list_items i ON i.location_id = s.id
          WHERE EXISTS (SELECT 1 FROM lead_run_stops st WHERE st.location_id = s.id)`,
      )
      .all() as unknown as { id: number }[]
  ).map((r) => r.id);

  if (pins.length === 0) {
    if (skipped.length > 0) reportFold(0, skipped);
    return { promoted: [], skipped };
  }
```

Then, after the existing `db.exec("COMMIT");` at the end of the transaction block, add the return and the reporter:

```ts
  reportFold(pins.map((p) => p.id), skipped);
  return { promoted: pins.map((p) => p.id), skipped };
}

/** One line, so an operator can see a fold that declined work without opening a log file.
 *  Silent is the failure mode this whole spec is about. */
function reportFold(promoted: number | number[], skipped: number[]): void {
  const n = typeof promoted === "number" ? promoted : promoted.length;
  if (n === 0 && skipped.length === 0) return;
  console.log(
    `[lead-pin-fold] ${n} promoted, ${skipped.length} waiting on a run` +
      (skipped.length ? ` (${skipped.join(", ")})` : ""),
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lead-pin-foldin.test.ts`

Expected: PASS — 4 passed (the original two plus the two new ones).

---

### Task 2: Drop the one-shot marker

**Files:**
- Modify: `lib/db.ts:3071-3081` (the boot call site)
- Modify: `tests/lead-pin-foldin.test.ts` (two new cases, one deleted)

**Why the marker is the bug and the predicate is not.** The fold's predicate is "a pin that is in a lead list." That is a fact about *rows*, not about *time*. A one-shot marker makes it time-dependent: any qualifying row that arrives **after** the marker is written is never promoted, no matter how long it waits. On a dev database the marker is dated before the oldest pin, so every pin sits after it — but the exact dates are demo artefacts. **The defect is the guard, not the gap.**

The fix is safe precisely because Task 1 made the fold non-destructive, and because the fold is already idempotent (`ON CONFLICT (organization_id, customer_code) DO NOTHING` on the `LEAD-<id>` code, the same scheme `/api/locations/[id]/convert` uses, so it cannot collide with a manually-converted pin). 25 rows is nothing. The guard exists to avoid work, not to avoid correctness.

- [ ] **Step 1: Write the tests**

In `tests/lead-pin-foldin.test.ts`, add:

```ts
  it("still runs when the one-shot marker is set", () => {
    /* The regression this task exists to prevent.
     *
     * The boot call site guarded the fold on `app_meta.lead_pin_foldin_done`, which
     * makes a data-dependent migration time-dependent: a pin added to a lead list today
     * would never be promoted, on any future boot, however long it waited. The marker is
     * written once and the guard then hides the fold forever.
     *
     * The fix is to run it unconditionally. This asserts the FUNCTION's behaviour; the
     * second test is what checks the call site, which is where the guard actually was. */
    const db = getDb();
    db.exec(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('lead_pin_foldin_done', '2020-01-01T00:00:00Z')`);

    // A pin that entered the business AFTER the marker was written.
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (920, 'پین تازه', 'https://maps.example/new', 'manual', 30, '2026-02-01', '2026-02-01', 3)`);
    db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 920, 1, '2026-02-01')`);

    foldLeadPinsIntoCustomers(db);

    expect(
      db.prepare("SELECT lifecycle FROM customers WHERE customer_code='LEAD-920'").get(),
    ).toMatchObject({ lifecycle: "lead" });
  });

  it("the boot call site does not gate the fold on a marker", () => {
    /* The test above passes whether or not the boot call site is guarded, so this is
     * the assertion that actually holds the fix. A one-shot guard there would make
     * every qualifying row that arrives later permanently unpromoted. */
    const src = readFileSync("lib/db.ts", "utf8");
    const from = src.indexOf("export function getDb");
    const call = src.slice(from, src.indexOf("backfillLegacyPayments", from));
    expect(call, "the boot call must be unconditional").not.toMatch(/lead_pin_foldin_done/);
  });
```

Add the import at the top of the file:

```ts
import { readFileSync } from "node:fs";
```


- [ ] **Step 3: Remove the marker check at boot**

In `lib/db.ts`, replace lines 3071-3081:

BEFORE:
```ts
  // Phase 0b: pins that reached a lead list become customers. Once, guarded on a marker,
  // but foldLeadPinsIntoCustomers is idempotent so a stray re-run is harmless.
  const foldDone = db
    .prepare("SELECT value FROM app_meta WHERE key = 'lead_pin_foldin_done'")
    .get() as { value: string } | undefined;
  if (!foldDone) {
    foldLeadPinsIntoCustomers(db);
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('lead_pin_foldin_done', ?)").run(
      new Date().toISOString()
    );
  }
```

AFTER:
```ts
  /* Phase 0b: pins that reached a lead list become customers.
   *
   * This used to run ONCE, guarded on an `app_meta` marker, and that guard was the bug.
   * The fold's predicate is "a pin that is in a lead list" — a fact about ROWS, not
   * about time. A one-shot marker makes it time-dependent: any qualifying row that
   * arrives after the marker is written is never promoted, on any future boot, however
   * long it waits. Which page shows a given lead was then a function of WHEN it was
   * added, and /leads (MANAGE_ROLES, pins) and /crm (CRM_ROLES, customers) could
   * permanently disagree about where it lives. The code permitted that forever, and
   * nothing reconciled the two.
   *
   * So it runs on every boot. The fold is idempotent (ON CONFLICT DO NOTHING on the
   * LEAD-<id> code, the same scheme the manual convert uses, so it cannot collide), and
   * it skips any pin a lead_run_stops row points at rather than cascading it away. The
   * cost is a couple of indexed queries per boot; the marker it replaces was saving work
   * at the price of correctness.
   *
   * The old key is left in app_meta untouched — a marker nobody reads is harmless, and
   * deleting it would be a migration for no gain. */
  foldLeadPinsIntoCustomers(db);
```

- [ ] **Step 4: Remove the now-stale test**

The existing test `"records that it ran, so the boot migration skips it"` asserts the marker exists *so the boot can skip the fold*. That is asserting the bug. **Delete it.**

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/lead-pin-foldin.test.ts`

Expected: PASS — 5 passed (the original idempotency case, the two from Task 1, the marker case, and the call-site guard).

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts tests/lead-pin-foldin.test.ts
git commit -m "fix(db): the pin fold is not a one-shot, and never was

The fold's predicate is 'a pin that is in a lead list' -- a fact about rows, not about
time. The app_meta.lead_pin_foldin_done marker made it time-dependent: a qualifying row
that arrived after the marker was written was never promoted, on any future boot,
however long it waited. Which page showed a given lead was then a function of WHEN it
was added -- /leads reads saved_locations under MANAGE_ROLES, /crm reads customers
under CRM_ROLES which includes phone_sales, and a rep's own leads could sit in the half
they cannot read. The code permitted that permanently and nothing reconciled the two.

It runs on every boot now. The fold is idempotent, and the previous commit made it skip
any pin a lead_run_stops row points at rather than cascading it away. The cost is a
couple of indexed queries per boot; the marker saved work at the price of correctness.


---

### Task 3: The copy — `/leads` is the map's inbox

**Files:**
- Modify: `lib/pageMeta.ts:31-35` (`/leads`'s overview)
- Modify: `components/leads/LeadListsBar.tsx` (the heading, one string)

**What changed underneath.** After Task 2, `/leads` holds **only pins in no list** — the ones that have not entered the business. That is a genuinely different thing from what it was, and the page must say so. The spec's §4.3 point applies here too: `crm/page.tsx:30` already filters on `lifecycle='lead'`, so a promoted pin appears for the rep **the moment the fold runs**. The capability was already built; only the data was in the wrong shape.

- [ ] **Step 1: Rewrite `/leads`'s overview**

BEFORE:
```ts
  "/leads": {
    title: "پین‌های نقشه",
    overview:
      "مکان‌هایی که از روی لینک نقشه ذخیره شده‌اند و هنوز سرنخ نشده‌اند. امتیاز بدهید و آن‌هایی که ارزش بازدید دارند را به یک روز کاری تبدیل کنید.",
  },
```

AFTER:
```ts
  "/leads": {
    title: "پین‌های نقشه",
    overview:
      /* The inbox, not a half-finished CRM. Every pin here is one nobody has DECIDED
       * about yet: the moment you add it to a list it becomes a سرنخ and stops being a
       * dot on a map. So the verb on this page is «افزودن به فهرست», and the copy names
       * the two questions the two pages answer. */
      "مکان‌هایی که روی نقشه دیده‌اید و هنوز دربارهٔ آن‌ها تصمیم نگرفته‌اید. هر پینی که به یک فهرست اضافه شود، سرنخ می‌شود و از این صفحه می‌رود. «پین‌های نقشه» جای مکان‌هایی است که دیده‌اید، «مشتریان و سرنخ‌ها» جای کسب‌وکارهایی که می‌شناسید.",
  },
```

- [ ] **Step 2: Update the `LeadListsBar` heading**

Search `components/leads/LeadListsBar.tsx` for the string that introduces the saved sets and change it so it names the *commit* action rather than only the storage. If it reads «فهرست‌های ذخیره‌شده», change it to:

```tsx
«فهرست‌ها — با افزودن به فهرست، پین سرنخ می‌شود»
```

**This is the §4.2 copy, and only the copy.** The spec's own §7 says "No UI work beyond the §4.2 copy. The page's structure is spec 1's business." So the «تبدیل به مشتری» button stays exactly where it is; what changes is that the list is no longer described as storage but as the thing that promotes a pin.

- [ ] **Step 3: Run the copy audit and the meta test**

Run: `npm run audit-copy && npx vitest run tests/pageMeta.test.ts`

Expected: both pass. `pageMeta.test.ts:45-51` requires every overview to be over 25 characters and free of `TODO`/`TBD`/`placeholder`.

- [ ] **Step 4: Commit**

```bash
git add lib/pageMeta.ts components/leads/LeadListsBar.tsx
git commit -m "docs(leads): the page is an inbox, and says what the verb is

After the fold re-runs, /leads holds only pins in no list -- the ones nobody has decided
about yet. That is a genuinely different thing from what it was, so the copy says so:
adding a pin to a list is what MAKES it a lead, and the two pages answer different
questions (the places you noticed, the businesses you know).

---

### Task 4: Guard — no one-shot data migration

**Files:**
- Create: `tests/no-one-shot-data-migration.test.ts`

Neither this guard nor Task 5's is required by the fold itself. Both are required by having *found* the bug by reading. Each turns one into something the build catches.

**Why this is a general rule, not a `db.ts` rule.** A one-shot marker is *correct* for a migration whose predicate is about the schema — "have I added this column yet?" — and wrong for one whose predicate is about rows. The test cannot tell those apart by reading a marker, so it applies a narrower, checkable rule: **a boot-time migration may not read an `app_meta` marker to decide whether to run.** The exemption list names the ones that legitimately do, and a second assertion keeps that list from going stale.

- [ ] **Step 1: Write the test**

Create `tests/no-one-shot-data-migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** A data-dependent migration may not be guarded by a one-shot marker.
 *
 *  A marker in `app_meta` is the right tool for a migration whose predicate is about the
 *  SCHEMA — "have I added this column yet?" — and the wrong tool for one whose predicate
 *  is about ROWS. `foldLeadPinsIntoCustomers` folds "a pin that is in a lead list";
 *  guarded on `app_meta.lead_pin_foldin_done`, any qualifying row that arrived after the
 *  marker was written was never promoted, on any future boot, however long it waited.
 *  Which page showed a given lead became a function of WHEN it was added.
 *
 *  The test cannot tell a schema predicate from a row predicate by reading a marker, so
 *  it applies the rule it CAN check: a migration called during boot may not read a marker
 *  to decide whether to run. */
const SRC = readFileSync("lib/db.ts", "utf8");

/** Boot-time markers that are legitimate, and why. Each of these changes the SCHEMA, so
 *  "have I done it yet" really is a question about time.
 *  Named individually, because a pattern no file is exempt from is a pattern nothing
 *  passes — and a test that quietly exempts everything is a test that guards nothing. */
const MARKER_OK: [string, string][] = [
  ["board_pocket_reminders_folded", "folds reminders into a board; it reads the ones it creates, so a second pass is a no-op and the marker is belt-and-braces"],
];

/** Strips comments, so a file's own explanation of a rule is not read as breaking it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
}

describe("no one-shot marker guards a data-dependent migration", () => {
  it("finds lib/db.ts at all (guards the test itself)", () => {
    expect(SRC).toContain("foldLeadPinsIntoCustomers");
  });

  it("the pin fold is not behind a marker", () => {
    const body = SRC.slice(SRC.indexOf("export function foldLeadPinsIntoCustomers"));
    expect(body.slice(0, 2000), "the fold function itself must not read app_meta")
      .not.toMatch(/app_meta/);
  });

  it("every marker read in lib/db.ts is one the exempt list names", () => {
    const reads = [...code(SRC).matchAll(/FROM\s+app_meta\s+WHERE\s+key\s*=\s*'([a-z_]+)'/g)]
      .map((m) => m[1]);
    expect(reads.length, "no marker reads found — has the file been restructured?").toBeGreaterThan(0);

    const known = new Set(MARKER_OK.map(([k]) => k));
    const unexplained = [...new Set(reads)].filter((k) => !known.has(k));
    expect(
      unexplained,
      `a marker read with no stated reason:\n${unexplained.join("\n")}\n` +
        `Either the migration is row-dependent and the marker must go, or add it to ` +
        `MARKER_OK in this file with a sentence saying why a marker is the honest answer.`,
    ).toEqual([]);
  });

  it("the exempt list is not a list of things nobody reads", () => {
    /* An exemption nobody checks is a hole waiting for a file to fall into. Every key in
     * MARKER_OK must still appear in the source, or the entry has gone stale and should
     * be deleted rather than trusted. */
    for (const [key, why] of MARKER_OK) {
      expect(SRC, `${key} (${why.slice(0, 30)}…) is no longer read from app_meta`).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/no-one-shot-data-migration.test.ts`

Expected: the first two pass (Task 2 fixed them). The third may fail if `lib/db.ts` reads a marker this test has not heard of; the fourth guards the exempt list.

If the third fails, read the key it names and decide honestly: is that migration's predicate about **rows** (marker must go) or about **schema** (add it to `MARKER_OK` with a reason)? **Do not add a key to silence it.**

- [ ] **Step 3: Commit**

```bash
git add tests/no-one-shot-data-migration.test.ts
git commit -m "test(db): a row-dependent migration may not be guarded by a one-shot marker

A marker in app_meta is right for a migration whose predicate is the SCHEMA -- have I
added this column yet -- and wrong for one whose predicate is ROWS. The fold reads 'a
pin that is in a lead list', so a marker made every qualifying row that arrived later
permanently unpromoted, and which page showed a lead became a function of when it was
added.

The test cannot tell those two apart by reading a marker, so it applies the rule it CAN
check: a boot-time migration may not read a marker to decide whether to run. The exempt
keys are named with reasons, and a test asserts the exemptions are not stale -- an
exemption nobody checks is a hole."
```


Copy only. The «تبدیل به مشتری» button keeps its place; what changes is that the list is
described as the thing that promotes a pin rather than as storage. Re-ordering the
buttons belongs to a plan that owns the page's structure."
```

The old key is left in app_meta: a marker nobody reads is harmless.

Also deleted the test that asserted the marker exists 'so the boot migration skips it'.
It was asserting the bug, and a test that pins a defect is worse than no test -- it
reads as a guarantee."
```

- [ ] **Step 2: Run the tests to see where they stand**

---

### Task 5: Guard — no unguarded `DELETE` under a live foreign key

**Files:**
- Create: `tests/no-cascade-migration.test.ts`

This is the generalisation of the specific hazard. `ON DELETE CASCADE` plus a hand-written `DELETE` is a combination that destroys data quietly, and the repo had no guard against it — which is why the fold was found by reading rather than by a failing test.

- [ ] **Step 1: Write the test**

Create `tests/no-cascade-migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** A migration may not DELETE from a table a live foreign key points at, unguarded.
 *
 *  `ON DELETE CASCADE` plus a hand-written `DELETE` destroys data quietly, and the
 *  database calls the result correct. `lead_run_stops.location_id` is
 *  `REFERENCES saved_locations(id) ON DELETE CASCADE`, and `foldLeadPinsIntoCustomers`
 *  issues `DELETE FROM saved_locations WHERE id = ?` — so promoting a pin that sat on a
 *  lead run took the run's stop with it. A driver's assigned work, a promise the office
 *  made that morning, gone with no error and no entry in any log.
 *
 *  The rule: every `DELETE FROM <table>` in lib/db.ts must either target a table no
 *  foreign key points at, or sit in a function that also contains a `NOT EXISTS` naming
 *  the FK's table. The second half is the one that matters — it is the fold's own fix,
 *  and it makes the DELETE conditional rather than merely present. */
const SRC = readFileSync("lib/db.ts", "utf8");

/** Tables some other table's FK cascades from, so a DELETE here takes more with it.
 *  Read from the schema rather than hard-coded, so the list cannot drift from reality. */
function cascadeTargets(): Set<string> {
  const out = new Set<string>();
  for (const m of SRC.matchAll(/REFERENCES\s+([a-z_]+)\s*\(\s*id\s*\)\s*ON DELETE CASCADE/gi)) {
    out.add(m[1]);
  }
  return out;
}

/** Splits lib/db.ts into top-level function bodies, so a guard is looked for in the
 *  function that contains the DELETE rather than anywhere in a 3000-line file. */
function functions(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const marks: { name: string; at: number }[] = [];
  for (const m of SRC.matchAll(/export function ([a-zA-Z0-9_]+)\s*\(/g)) marks.push({ name: m[1], at: m.index! });
  for (let i = 0; i < marks.length; i++) {
    out.push({ name: marks[i].name, body: SRC.slice(marks[i].at, marks[i + 1]?.at ?? SRC.length) });
  }
  return out;
}

describe("no unguarded DELETE under a live foreign key", () => {
  it("found the cascade FKs at all (guards the walker itself)", () => {
    expect(cascadeTargets().has("saved_locations")).toBe(true);
  });

  it("no function deletes from a cascade target without a NOT EXISTS naming it", () => {
    const targets = cascadeTargets();
    const offenders: string[] = [];

    for (const fn of functions()) {
      for (const m of fn.body.matchAll(/DELETE\s+FROM\s+([a-z_]+)/gi)) {
        const table = m[1];
        if (!targets.has(table)) continue; // nothing points at it — the delete is local
        /* The guard has to name the FK's table, because that is what makes the DELETE
           conditional: a NOT EXISTS on some other table would not stop the cascade. */
        if (!new RegExp(`NOT\\s+EXISTS[\\s\\S]{0,200}?${table}`, "i").test(fn.body)) {
          offenders.push(`${fn.name}: DELETE FROM ${table}`);
        }
      }
    }

    expect(
      offenders,
      `a DELETE from a table a live FK cascades from, with no NOT EXISTS naming it:\n${offenders.join("\n")}\n` +
        `That is how a migration destroys a row another table depends on, and calls it correct.`,
    ).toEqual([]);
  });

  it("the fold's own guard is in the same function as its delete", () => {
    /* The general rule above is per-function. If someone later moves the NOT EXISTS into
     * a caller, the fold's DELETE becomes unguarded again and this names it directly. */
    const fold = functions().find((f) => f.name === "foldLeadPinsIntoCustomers");
    expect(fold, "the fold function must still exist").toBeTruthy();
    expect(fold!.body).toMatch(/NOT\s+EXISTS[\s\S]{0,200}?saved_locations/i);
    expect(fold!.body).toMatch(/DELETE\s+FROM\s+saved_locations/i);
  });
});
```

- [ ] **Step 2: Run it**

### Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. The fold's return type changed from `void` to `LeadPinFoldResult`, and the only caller in the tree is the boot call site, which ignores it — so `tsc` is the check that no second caller depended on `void`.

- [ ] **Step 2: Run the full suite**

```bash
setsid nohup npx vitest run > /tmp/vitest-spec3.log 2>&1 &
```

Poll `/tmp/vitest-spec3.log`. About 14 minutes.

Expected: **2 failed / ~2765 passed**, failures being exactly `tests/jalali.test.ts` and `tests/api/routing-route.test.ts`. Confirm with `npx vitest run tests/jalali.test.ts tests/api/routing-route.test.ts` — both pass alone. Any other failure is real.

- [ ] **Step 3: The spec's regression list, one by one**

Run: `npx vitest run tests/lead-pin-foldin.test.ts tests/no-one-shot-data-migration.test.ts tests/no-cascade-migration.test.ts tests/leads-plain-objects.test.ts tests/crm-businesses-repo.test.ts tests/pageMeta.test.ts`

Expected: all pass. The spec names `leads-plain-objects` and `crm-businesses-repo` as **must stay green** — the pool still returns plain objects, and `lifecycle='lead'` is a value the CRM repo already handles. Neither may be disturbed by a fold that now runs on every boot.

- [ ] **Step 4: Boot the real database and confirm the damage did not happen**

This is the one verification a test cannot do for you. The dev database is a seed, and §1 of the spec is explicit that a row count proves nothing about the product — but it *does* prove the migration is safe on real-shaped data.

First, find the file and **back it up**:

```bash
ls data/
cp data/<the .db file> /tmp/routeflow-spec3-backup.db
```

Then boot once in a way that runs `getDb()` — a short script, or any test opened against the real path. **Never do this against a database you cannot restore.** After the boot, check:

```sql
SELECT COUNT(*) FROM lead_run_stops s JOIN saved_locations l ON l.id = s.location_id;
```

Expected: **non-zero, and the same as before the boot.** Every one of those is a stop that survived a fold that ran without the marker. If it is zero, restore from the backup and stop.

- [ ] **Step 5: Commit any test-only corrections**

If a test needed fixing, commit it separately, naming the invariant rather than the symptom.

---

## What this plan does not do

Named here so nothing in it is assumed done later.

- **`saved_locations` is not dropped.** Pins in no list are a legitimate state (`db.ts:630` says so), and `lead_run_stops.location_id` → `saved_locations` is a live FK. Deleting the table would break the driver run.
- **`/leads` is not merged into `/crm`.** They answer different questions — *places I noticed* vs *businesses I know* — and spec 1 already separates them by audience.
- **No data is invented.** Every qualifying pin becomes exactly one lead, and pins on an unfinished run wait. Nothing is created, merged, or guessed.
- **The «تبدیل به مشتری» button is not re-ordered.** Copy only, per the spec's own §7.
- **No UI work beyond the §4.2 copy.** The page's structure is spec 1's business.
- **The three-maps consolidation is not done here, and is not going to be.** It was measured and **dropped**: `CoverageMap` is 2,513 lines with clustering, GeoJSON districts and heat layers, while `LeadsMap` is 309 and `PlannerRouteMap` is 141. They share a library, not a component. Merging them would produce one file with a mode flag. Dropped, not deferred.
- **The "route means four things" vocabulary problem is one stale string, not a systemic issue**, and it is fixed in spec 2 §5 (`/planner`'s overview). Not carried here.


Run: `npx vitest run tests/no-cascade-migration.test.ts`

Expected: PASS. Task 1 put the `NOT EXISTS` in the same function as the `DELETE`, so both assertions hold.

If the second test names a function this plan has not heard of, **read it before exempting anything.** A `DELETE` that cascades is a real hazard, and the fix is a `NOT EXISTS` in the read — not an entry in an exemption list.

- [ ] **Step 3: Commit**

```bash
git add tests/no-cascade-migration.test.ts
git commit -m "test(db): no DELETE under a live ON DELETE CASCADE without a NOT EXISTS

ON DELETE CASCADE plus a hand-written DELETE destroys data quietly, and the database
calls the result correct. lead_run_stops.location_id cascades from saved_locations, and
the fold deleted from saved_locations -- so promoting a pin that sat on a lead run took
the run's stop with it. A driver's assigned work, a promise the office made that
morning, gone with no error.

The cascade targets are read from the schema rather than hard-coded, so the list cannot
drift from reality, and the guard is looked for per FUNCTION -- a NOT EXISTS in a caller
does not make a DELETE inside a callee safe."
```


Run: `npx vitest run tests/lead-pin-foldin.test.ts`

Expected: the first new test **passes** — calling the function directly bypasses the boot call site, so the guard cannot affect it. The second new test **fails**, because the boot call site still checks the marker. That failure is the bug, demonstrated at the place it lives.


- [ ] **Step 6: Commit**

```bash
git add lib/db.ts tests/lead-pin-foldin.test.ts
git commit -m "fix(db): promoting a pin must never destroy a run stop

lead_run_stops.location_id is REFERENCES saved_locations(id) ON DELETE CASCADE, and
foldLeadPinsIntoCustomers issues a hand-written DELETE FROM saved_locations. So
promoting a pin that sat on a lead run deleted the pin, the cascade took the stop with
it, and SQLite called the transaction correct. A driver's assigned work -- a promise
the office made that morning -- gone, silently, by design.

One NOT EXISTS clause in the existing SELECT. It is in the READ rather than a guard
around the write, so there is no window between 'checked' and 'deleted', and the
exposure cannot be measured to justify not having it: on a dev database it is a
handful of rows, on a real one it is zero or every run in the business.

A finished run releases its leads -- the same status != 'done' rule
readLeadRunAssignments uses -- so the pin is promoted on a later boot. The migration is
eventually consistent with the runs, not destructive to them.

The fold now returns what it promoted and what it declined. The failure mode of this
migration is silence, and a test can assert a return value but not a log line."
```

  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lead-pin-foldin.test.ts`

Expected: FAIL on the first new test. Today the fold promotes pin 910 and deletes it, and the cascade takes the stop — so `result.skipped` is `undefined` and the stop is gone. **That failure is the bug, demonstrated.**

### Decisions the spec leaves to the plan

- **What does the fold return?** The spec says "log or return the skipped count so the behaviour is visible rather than silent — the whole failure mode here is silence." **Returns a result object** and logs a one-line summary. A return value is testable; a log line is not. Both, because the return is for the test and the log is for the operator.
- **Does `LeadListsBar`'s primary verb change?** The spec's §4.2 says adding a pin to a list "becomes the way to *commit* a pin", and that «تبدیل به مشتری» "stops being the primary verb". That is a UI re-ordering, and the spec's own §7 says "No UI work beyond the §4.2 copy. The page's structure is spec 1's business." **This plan does the copy only** — the `pageMeta` overview and the `LeadListsBar` heading. Re-ordering the buttons is left for a plan that owns the page's structure.
