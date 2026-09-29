# One lead, one place: finishing the pin→customer migration

**Date:** 2026-09-29
**Status:** design agreed in dialogue, awaiting implementation plan
**Scope:** spec 3 of 3. **Runs after** spec 1 (`/leads` is the office) and spec 2
(orders + the day).

---

## 1. What the live data actually says

This spec started from a wrong assumption, so the first section is the measurement that
corrected it. Queried against `data/routeflow.db` on 2026-09-29:

| Query | Result |
|---|---|
| `saved_locations` (pins) | **25** |
| pins that are in a lead list | **25** (all of them) |
| `lead_list_items` | 76 rows across 14 lists |
| `lead_list_items` whose pin is gone | **0** |
| `customers` | **1** (`CRM-…-ksws4w`, lifecycle `qualified`) |
| `customers` with `lifecycle='lead'` | **0** |
| `customers` with a `LEAD-` code | **0** |
| `customers.lead_location_id` set | **0** |
| `app_meta.lead_pin_foldin_done` | `2026-09-16T23:29:16.573Z` |
| oldest `saved_locations.created_at` | **`2026-09-19T00:13:40.508Z`** |
| pins with no `lat`/`lng` | **0** |

**The fold ran on 16 September. Every pin was created on or after 19 September.**

`lib/db.ts:3072-3079` guards `foldLeadPinsIntoCustomers` behind a one-shot marker. It
ran, found nothing, wrote the marker, and will never run again. So the 25 pins that *now*
satisfy its own `JOIN lead_list_items` predicate are, and will remain, **pins** — because
they arrived three days after the migration that would have absorbed them.

The migration is not half-finished by accident. **It finished, and then the work
continued in the old shape.**

**And the obvious fix is a trap.** §4.1 proposes re-running the fold. Measured against the
live schema, that would **silently destroy 10 of 58 run stops** — see §5. The precondition
in §5.1 is not an optional refinement; it is the difference between this spec being a fix
and being a data-loss incident.

## 2. The incoherence this creates

The word *سرنخ* (lead) means two different things, in two tables, with two permission
models:

| | Pins — `saved_locations` | Businesses — `customers` |
|---|---|---|
| Page | `/leads` — «پین‌های نقشه» | `/crm` — «مشتریان و سرنخ‌ها» |
| API | `/api/locations` — `MANAGE_ROLES` | `/api/crm/businesses` — `CRM_ROLES` |
| Who can read | managers only | `phone_sales` included |
| Is it a "lead"? | it *is* one | `lifecycle='lead'` |
| Reachable by a rep? | **no — 403** | yes |

So **`phone_sales` sees zero leads on `/crm`** (there are none — `lifecycle='lead'` is
0) and **cannot open `/leads`** (`/api/locations` is manager-gated). A rep with leads to
work has nowhere to look. Meanwhile a manager looking at `/crm` sees one `qualified`
customer and no prospects at all, because the 25 real prospects are pins.

**Neither page shows the truth.** That is the incoherence, and it is why "show me the
leads" has no single answer in this app.

## 3. What the code already believes

The migration's own comment (`lib/db.ts:626-631`) states the intended end state:

> *"a pin that made it into a lead list is a relationship worth tracking, not just a dot
> on the map. Promote each such saved_location to a `customers` row … Pins in no list stay
> as pins."*

**That is exactly right, and it is already implemented.** The rule is: *a pin that has
entered the business becomes a customer; a pin that has not is still a dot.* The only

## 4. Design

### 4.1 Re-run the fold, without the one-shot guard

The predicate is already correct. The guard is the bug: a *one-shot* marker for a
*migration that depends on data arriving later*. A pin created today would never be
promoted either.

**Replace the one-shot marker with a state check.** `foldLeadPinsIntoCustomers` is already
idempotent (`ON CONFLICT (organization_id, customer_code) DO NOTHING` on the code), so it
can run on every boot. 25 rows is nothing. The guard exists to avoid work, not to avoid
correctness.

Concretely: drop the `app_meta` marker check at `db.ts:3072-3075` and call the fold
unconditionally once the schema is ready. The `LEAD-<id>` code scheme already prevents
collisions with manually-converted pins (`/api/locations/[id]/convert` uses the same
scheme, and the fold's `DO NOTHING` makes a double-run a no-op).

**This is the whole fix for §2** — *together with the §5.1 precondition, which is
mandatory.* After it runs, the eligible pins become `customers` rows with
`lifecycle='lead'` and `LEAD-<id>` codes, and the reps' world can finally see them. The 10
pins currently on a live run are promoted later, once those runs are done.

### 4.2 `/leads` stops being a lead manager and becomes the map's inbox

After §4.1, `/leads` holds **only pins in no list** — the ones that have not entered the
business. That is a genuinely different thing from what it is now, and the page must say
so.

- **Copy** in `lib/pageMeta.ts` changes from «مکان‌هایی که … هنوز سرنخ نشده‌اند» (pins that
  have not yet become leads) to describe the inbox: *a place you saw and saved but have not
  yet decided about.*
- `LeadListsBar` — the saved sets — becomes the way to *commit* a pin, since adding to a
  list is what triggers promotion. The page's primary verb inverts: today you convert a
  pin to a customer; after this, **you add it to a list, and the system promotes it.**
- The «تبدیل به مشتری» button (`convertToCustomer`) stays for the single-pin case and
  remains the manual path, but it stops being the primary verb.

**No page is deleted.** `/leads` remains the place to *see and triage* uncommitted pins,
which is a real job: a manager walking a district drops pins, then decides which are worth
the business. Spec 1 makes it manager-only, which is exactly the right audience for it.

### 4.3 A rep's leads finally exist

After §4.1, `phone_sales` opens `/crm` and sees `lifecycle='lead'` rows — because
`/api/crm/businesses` admits `CRM_ROLES`, and `lifecycle='lead'` is exactly the filter
`crm/page.tsx:30` already applies for the `my_leads` view.

**No new page, no new API, no new permission.** The rep surface starts working the moment
the data is promoted. This is the strongest argument for §4.1: the fix *is* a migration,
and the capability it unlocks was already built.

### 4.4 What is deliberately NOT done

- **`saved_locations` is not dropped.** Pins in no list are a legitimate state
  (`db.ts:630` says so), and `lead_run_stops.location_id` → `saved_locations` is a live FK
  (`lib/repo/leadRuns.ts:62`). Deleting the table would break the driver run.
- **`/leads` is not merged into `/crm`.** They answer different questions — *places I
  noticed* vs *businesses I know*. Spec 1 already separates them by audience.
- **No data is invented.** 25 pins become at most 25 leads, and 10 of them wait for their
  run. Nothing is created, merged, or guessed.

## 5. Risk

**The data is safe; the deletion is not — and this is the whole risk.**

`lead_run_stops` carries `location_id INTEGER NOT NULL REFERENCES saved_locations(id)
ON DELETE CASCADE` (verified against the live schema). The fold does
`DELETE FROM saved_locations WHERE id = ?` (`db.ts:662`).

**So promoting a pin deletes the row its run stop points at, and the cascade takes the
stop with it — silently.**

Measured on live data, this is not hypothetical:

| Query | Result |
|---|---|
| `lead_runs` | 6 |
| `lead_run_stops` | **58** (all `status='planned'` — none finished) |
| pins in a list **and** on a run | **10 of the 25** |
| those 10 as a share of all run stops | **10 of 58** |

**Running the fold as it stands would silently destroy 10 stops on 6 live, unfinished runs
— a fifth of a driver's day, with no error anywhere.** No exception, no failed test, no
console message. A cascade is the database agreeing to help.

This is the reason the naive reading of §4.1 ("just drop the guard and re-run it") is
wrong, and it is why the spec's own §1 measurement mattered: had I designed this from the
schema alone I would have shipped the destruction.

### 5.1 The precondition

`foldLeadPinsIntoCustomers` must **skip any pin that has a `lead_run_stops` row**, and
report what it skipped. One `NOT EXISTS` clause in the existing `SELECT`:

```sql
AND NOT EXISTS (SELECT 1 FROM lead_run_stops st WHERE st.location_id = s.id)
```

With that clause the 10 pins stay pins until their run is done, and the *next* boot
promotes them. The migration becomes **eventually consistent with the runs** rather than
destructive to them — which is the correct relationship: a driver's assigned work is a
promise, and a schema migration must not break a promise the office made this morning.

The existing `if (pins.length === 0) return` early-out already handles the quiet case. The
function should log or return the skipped count so the behaviour is visible rather than
silent — **the whole failure mode here is silence.**

### 5.2 Remaining checks

| Check | How it is verified |
|---|---|
| The fold is idempotent | `tests/lead-pin-foldin.test.ts` already asserts a second run throws nothing and creates no second row |
| **It never cascades a run stop** | new: a pin with a `lead_run_stops` row is skipped, and the stop still exists afterwards |
| It is tenant-safe | both tables carry `organization_id`, and the insert binds it |
| Nothing else reads pins | 12 call sites reference `saved_locations` — `/api/locations`, `/api/lead-lists`, `/api/visit-plans`, `admin/groups`, `repo/leadRuns` — all keep working, because pins **in no list** remain pins |
| Re-running is safe after runs finish | the skipped 10 are promoted on a later boot; the test simulates a finished run and asserts promotion |

## 6. Testing

| File | Asserts | State |
|---|---|---|
| `tests/lead-pin-foldin.test.ts` | **edit** — (a) a pin with a `lead_run_stops` row is **skipped**, and **the stop still exists** after the fold; (b) once the run is `done`, the pin is promoted; (c) the fold runs even when `app_meta.lead_pin_foldin_done` is set (the §4.1 regression) | edit |
| `tests/no-one-shot-data-migration.test.ts` | **new** — a data-dependent migration in `lib/db.ts` may not be guarded by a one-shot `app_meta` marker | new |
| `tests/no-cascade-migration.test.ts` | **new** — no migration in `lib/db.ts` may `DELETE` from a table a live FK points at, without a `NOT EXISTS` guard naming that FK | new |
| `tests/leads-plain-objects.test.ts` | **must stay green** — the pool still returns plain objects | regression |
| `tests/crm-businesses-repo.test.ts` | **must stay green** — `lifecycle='lead'` is a value it already handles | regression |

The first row is the one that matters, and it must assert the **stop survives**, not just
that the pin was skipped. Asserting the skip alone would pass even if the delete still
happened.

The third row generalises §5.1: `ON DELETE CASCADE` plus a hand-written `DELETE` is a
combination that destroys data quietly, and the repo has no guard against it.

## 7. Out of scope

- **Spec 1 and spec 2 land first.** They change `/leads` and the pages around it; this
  spec changes what `/leads` *holds*. Doing it first means redoing the framing.
- **The three-maps consolidation** (`CoverageMap` / `LeadsMap` / `PlannerRouteMap`) — a
  real coherence issue, with its own risk profile.
- **The vocabulary cleanup** ("route" meaning four different things) — naming, not data.
  Follows the pages settling.
- **No UI work beyond the §4.2 copy.** The page's structure is spec 1's business.
