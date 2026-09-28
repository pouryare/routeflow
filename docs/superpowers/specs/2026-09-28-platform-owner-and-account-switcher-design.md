# The platform owner, and the account switcher

**Date:** 2026-09-28
**Status:** approved design, ready for an implementation plan
**Depends on:** `2026-09-28-multi-role-switcher-design.md` (Phase A) — **not yet built**

**Touches:** `lib/roles.ts`, `lib/session.ts`, `lib/impersonation.ts`, `lib/platformAccess.ts`,
`lib/repo/impersonation.ts`, `lib/repo/search.ts`, `proxy.ts`, `lib/appNav.ts`,
`app/api/admin/impersonate/route.ts`, `app/api/admin/impersonatable/route.ts`,
`app/(bare)/driver/page.tsx`, `app/(bare)/today/page.tsx`, `app/(shell)/switch/page.tsx`,
`components/meridian/ProfileMenu.tsx`, `components/meridian/AccountSwitcher.tsx`,
`components/meridian/ImpersonationBanner.tsx`, `lib/db.ts`,
`scripts/create-user.mjs`, `scripts/seed-demo-org.mjs`

---

## 1. The problem

`platform_owner` exists in the type system and in the scoping layer, and is **locked out of
almost every gate in the app**.

- **189 of 190** `requireRole(req, [...])` call sites in `app/api/**` omit it. One includes it.
- `proxy.ts` names roles explicitly in **5** branches and omits it in all 5.
- `app/(shell)/sales/admin/layout.tsx:36` reads `session.role !== "owner"` — a platform owner
  is bounced out of the admin area.
- `app/(shell)/sales/{cheques,batches,deliveries,forecast,routing}/page.tsx` each check
  `owner || group_manager` only.
- `appNav.ts` marks three tabs `r === "owner"` — the platform owner sees them greyed out.
- `lib/repo/search.ts:81` returns `[]` for anyone who is not `owner`, so the Login-As search
  finds nothing.

Meanwhile `lib/session.ts` *does* treat the role as all-powerful: `scopeGroupIds` returns
`"all"`, `orgFilter` returns an empty fragment, `canReachOrg` returns `true`. **The scoping was
built in Phase 0a; the gates never got the name.**

There is a second, quieter hole. `POST /api/admin/impersonate` mints a session in another
person's name and sets an `act` claim. `lib/session.ts:50-57` re-validates that claim on every
single request. **And then `session.actorId` is never written to any audit row** — it exists
only to draw a banner. A write performed under impersonation is attributed to the
impersonated user alone, with no record that anyone else was driving.

---

## 2. What is being built

Three things, in this order.

| # | Thing | Why it is separate |
|---|---|---|
| **A** | Multi-role (`user_roles`, `session.role` + `session.roles`, the picker) | **Already specified in `2026-09-28-multi-role-switcher-design.md` and NOT BUILT.** It is the foundation: "pourya is `platform_owner` *and* `owner*" is not expressible until it exists. |
| **B1** | `platform_owner` in every gate — *god mode* | Purely a gate problem. No new concepts. |
| **B2** | The account switcher — cross-tenant, any account, banner + honest audit | Needs a new screen and an API. |
| **C** | A second demo tenant with fake data | Touches **no auth code**. Can ship any time; exists so the cross-tenant paths are actually exercised before a real customer exists. |

**A must land before B.** B1 and B2 could arguably ship in either order, but B2's "any
account, any organisation" list is far easier to build and test once `user_roles` exists,
because the switcher has to render a target's full role *set*.

### 2.1 Phase A is partly built, and the data is already migrated

**Revision 2 (2026-09-28).** The first draft of this section said the 215 uncommitted files
were "a partial execution of Phase A's Step 3a" — the mechanical
`session.role === "driver"` → `isVanRole(session.role)` rename — and that they were
`tsc`-clean. **Both claims were wrong**, and the second was load-bearing.

Measured against the working tree: 215 files, 792 insertions, 552 deletions, containing

- the van rename (as described), **and**
- `salesperson` → `phone_sales` across 334 lines (Phase A's D4), **and**
- the `users.role` CHECK-constraint rebuild, +99 lines in `lib/db.ts` (Phase A's **Task 8**,
  the fifth table rebuild and one of the riskiest items in that plan), **and**
- a half-finished `lib/repo/syncMutations.ts` whose `ORDER_ROLES` still held both retired
  names, which `tsc` rejected — Phase A's **Task 5**, started and abandoned.

**And the live database had already been migrated.** `users.role` held only `owner` (1) and
`delivery_driver` (5); no `driver` and no `salesperson` remained. This was not a draft in a
working tree — it was a schema migration applied to real data, uncommitted and untested.

**The error's cause is worth recording**, because it is a process failure and not a typo: the
claim was inferred from the last commit message (`docs(plan)`) plus the existence of modified
files, without measuring the diff. Prose about inherited work is not a verification. Run
`git diff` and count.

**Resolved 2026-09-28.** Verified — `vitest run` 330 files passed / 13 skipped, exit 0;
`tsc --noEmit` exit 0 after fixing `ORDER_ROLES` (now `satisfies OrderRole[]`, so the build
fails if the list and the union drift again); `npm run lint`'s 43 errors proven pre-existing
by intersecting all 26 error files against the 215 changed files — zero intersection.
Committed as two commits, `c8489ed` (schema + vocabulary, the risky half, reviewable alone)
and `1b343e7` (209 call-site files).

**What remains of Phase A:** `user_roles` does not exist. Tasks 2, 3, 4a, 4b, 5 and 9 are
ahead. Tasks 1, 3, 7 and 8 are done.

---

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| P1 | `platform_owner` is added to **every** management gate | The scoping layer already treats it as all-powerful. The gates are the only thing out of step. |
| P2 | Enforced as **one constant**, `MANAGE_ROLES`, not 190 hand edits | The Phase A spec's own lesson (§3.3): "zero diff at the comparison sites" was a false claim that hid nineteen broken queries. 190 hand edits will hide something. |
| P3 | The rule is stated as an **executable invariant** — `platform_owner` reaches everything `owner` reaches | Makes the design decision a fact that fails loudly, instead of a convention nobody re-checks. |
| P4 | **Exactly one `platform_owner` exists, and it is the founder** | §4.4 — removing `UNTOUCHABLE` is only safe while there is one. |
| P5 | God mode = **infinite read, attributed write** | §4.1. |
| P6 | The switcher grants **full write**, not read-only | A support tool that cannot fix anything is a screenshot tool. |
| P7 | Writes under impersonation record **both** names | §4.8. This is the design's most important correctness fix. |
| P8 | The switcher is **one component, two mounts** — the avatar menu (A) and `/switch` (B) | The list was never inside the menu, so promoting it is free. |
| P9 | `/driver` and `/today` show a **notice**, not a redirect, for `platform_owner` | The founder asked for this by name. A redirect is a dead end; the notice offers the way forward. |
| P10 | `logPlatformAccess` is **wired in** | It is fully implemented and **called from nothing**. Built in Phase 0a, never connected. |
| P11 | No "view any driver's day" mode | §4.3. |

---

## 4. Design

### 4.1 God mode: infinite read, attributed write

| | as pourya (god mode) | as a switched account |
|---|---|---|
| See every org's customers, orders, leads | ✅ | only the target's |
| Reach every page, no gate | ✅ | the target's own reach |
| **Write** | ✅ — every row records `pourya` as author | ✅ — recorded as *the target*, with `impersonated_by = pourya` |

**"Infinite" is qualified in exactly one place: writes are always attributed.** This is not a
restriction on what pourya may do — he may do everything. It is a statement of *whose name is
written down*, which is a different question from *what is permitted*.

Two independent mechanisms, neither a bypass flag:

- **God mode** — pourya acting as himself, `platform_owner`, full reach.
- **The switcher** — pourya acting as somebody else, exactly their permissions.

### 4.2 The gates, via one constant

```ts
// lib/roles.ts
/** Roles that manage: full authority inside their own scope.
 *  platform_owner is a strict SUPERSET of owner — the god key. The invariant test in
 *  tests/platform-owner-reach.test.ts is stated as "superset" for exactly this reason. */
export const MANAGE_ROLES: Role[] = ["platform_owner", "owner", "group_manager"];
```

Every gate whose meaning is *"is this person in charge?"* becomes:

```ts
// BEFORE — 189 sites, each a hand-typed list that forgot platform_owner
requireRole(req, ["owner", "group_manager"]);

// AFTER — one rule, tsc propagates it
requireRole(req, MANAGE_ROLES)
```

`requireRole` already accepts a list, so **the diff is a substitution with no signature
change** and the compiler finds every site. Then ~15 hand-checked: the 5 `proxy.ts` branches,
the 6 page gates, and the 3 `appNav.ts` owner-only tabs.

Lists that are genuinely *not* "is this person in charge?" are left alone — the order state
machine's `OrderRole`, the per-role data-scoping queries, and the `SELF_ROLES`/`ROLES` lists
in `/api/prefs` and `/api/push/subscribe` (which already include `platform_owner`).

#### The invariant test — the safety net

```ts
// tests/platform-owner-reach.test.ts
test("platform_owner reaches everything owner reaches", () => {
  for (const route of ALL_ROUTES) {
    expect(admit("platform_owner", route), route).toBe(admit("owner", route));
  }
});
```

A second loop asserts the **mirror image** — that `platform_owner` is a *superset*, never a
subset — so nobody can "fix" a future failure by loosening the first.

### 4.3 `/driver` and `/today`: a notice, not a redirect

Three gates currently bounce a non-van role. All three change:

```ts
// app/(bare)/driver/page.tsx:42   was: if (!isVanRole(session.role)) redirect("/map");
if (!isVanRole(session.role)) return <NotAVanNotice />;
```

The notice, in the app's voice:

> **شما راننده نیستید**
> این صفحه برنامه و توقف‌های یک راننده را نشان می‌دهد. برای دیدن برنامهٔ امروز یک راننده، به‌عنوان او وارد شوید.
> `[ورود به‌عنوان راننده]` — opens the switcher, pre-filtered to van roles

**`proxy.ts:110` must also exempt `platform_owner`**, or the notice never renders — the
request is bounced before the page loads. That exemption is scoped to `platform_owner`
**only**; `owner` and `group_manager` still bounce, because they were not invited to inspect
a driver's day.

**Why no "view any driver's day" mode (P11).** `/driver` reads
`readDriverRuns(db, session.user.id)` — *your* runs. A view mode would be a second, weaker
implementation of what the switcher already does properly, with worse attribution: the writes
would carry no impersonation at all, so the audit trail would need a second mechanism to
explain them. The notice plus a pre-filtered switcher button is the honest version.

### 4.4 Exactly one platform owner (P4)

```ts
// tests/platform-owner-uniqueness.test.ts
test("exactly one platform_owner, and it is the founder", () => {
  const owners = db.prepare(
    `SELECT u.display_name FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE r.role = 'platform_owner'`
  ).all();
  expect(owners).toHaveLength(1);
});
```

`POST /api/admin/users`, `PATCH /api/admin/users/[id]` and `scripts/create-user.mjs` all
**refuse to assign `platform_owner`**. `create-user.mjs` keeps it in its `ROLES` list —
`tests/roles.test.ts:46` already asserts that list never drifts from `lib/roles.ts` — but
gains a guard refusing to create a second one.

### 4.5 The switcher

**One component, two mounts (P8).** `components/meridian/AccountSwitcher.tsx` renders the
search box and the org-grouped account list, driven by one endpoint. It is mounted:

- **A** — inside `ProfileMenu`, one row: «ورود به‌عنوان…» (the primary surface)
- **B** — at `/switch`, the full page (for the 20+ accounts / multi-tenant future)

The list was never written *into* the menu, so promoting it to a page is a mount, not a
rewrite.

**The list** shows every active user in every organisation, grouped by organisation then
role, search-first. `lib/repo/search.ts:81`'s `role !== "owner"` restriction is lifted. The
founder's own row is shown but not selectable.

### 4.6 Refusals — `impersonationRefusal` stays a pure function

`lib/impersonation.ts` is a pure function over two plain objects, which is what makes it cheap
to test exhaustively. Changes:

| Rule | Today | Proposed | Why |
|---|---|---|---|
| Who may switch | `role === "owner"` | `owner` **or** `platform_owner` | the founder is a platform owner, not an owner |
| Same org only | refuse | **removed** | cross-tenant support is the point |
| Target's roles | primary only | **full set** | Phase A §5.0 already decided this |
| Self-switch | refuse | refuse (unchanged) | |
| `UNTOUCHABLE` | owner, platform_owner | **removed** | §4.7 |

### 4.7 Removing `UNTOUCHABLE` is coupled to uniqueness (P4)

The founder can act as any working account in any organisation, **including a tenant's
`owner`** — full authority with none of the accountability of that office.

This is safe **only** because there is exactly one platform owner, and it is the founder. It
becomes a liability the moment a second platform owner exists or a contractor is given the
role. **The uniqueness test (§4.4) is what holds this up**, and the coupling is documented in
the code where `UNTOUCHABLE` used to be defined, so nobody deletes one and keeps the other.

### 4.8 The audit — both names, always (P7)

**The finding.** `session.actorId` is set, carried in the signed cookie, and re-validated on
every request by `lib/session.ts:50-57` — and then **never written to any audit row**.

```ts
// lib/repo/orders.ts:211 — what a write under impersonation currently records
actor_user_id: actor.id,     // the impersonated user, alone
```

```bash
$ grep -rn "session.actorId" app/api/ lib/ | grep -v lib/session.ts
(no matches)
```

So a fix performed by the founder while acting as a driver is attributed to **the driver**,
with no record that anyone else was driving. The only trace is a start/stop pair in the
events log that the tenant will never read. The record then misattributes the founder's work
to a person who did not do it.

**The fix.** Two fields, written together, on **the three tables that already record an
actor** — no new audit table:

| Table | Column added | Already records |
|---|---|---|
| `activity_log` | `impersonated_by` | `changed_by_user_id` |
| `order_events` | `impersonated_by` | `actor_user_id` |
| `events` | `impersonated_by` | `actor_user_id` |

```ts
// every write path, from the same session
actor_user_id:   session.user.id,        // رضا — the account it happened in
impersonated_by: session.actorId ?? null // پوریا — who was really driving
```

All three are nullable `INTEGER REFERENCES users(id)`, added by the same idempotent
`hasCol`-guarded `ALTER TABLE` pattern `scripts/seed-demo.mjs` already uses.

`auth.impersonation_started` / `_ended` already exist via `emitEvent`, and
`platform_access_log` already exists and is unwired (§4.9) — **no new audit infrastructure is
introduced at all.** The gap was a missing column, not a missing system.

**The rendering rule, stated explicitly so it cannot be read two ways:** the
`«توسط پوریا»` tag renders **only when `impersonated_by` is non-null AND the viewer is a
`platform_owner` or `owner`**. A `group_manager` or a driver sees the plain history, with no
tag and no trace.

**What each surface shows:**

| Surface | Shows |
|---|---|
| Customer / order history (tenant-facing) | the account's name, plus a collapsed **«توسط پوریا»** tag, to `platform_owner`/`owner` viewers only |
| `events` + `platform_access_log` (founder-facing) | both names, always |

A `group_manager`, a `phone_sales` and a driver see the plain history — the account's name,
no tag, no trace. The founder's own record stays accurate, and his involvement is on file for
the people accountable for it.

**The two ways to act, both available:**

| Situation | How | Recorded as |
|---|---|---|
| Fix a driver's stuck stop | switch to him | رضا, tagged «توسط پوریا» |
| Correct a customer's phone in tenant 3 | god mode, as yourself | **پوریا** + a `platform_access_log` row |

The system does not force one; the choice is per action.

### 4.9 `logPlatformAccess` is wired in (P10)

`lib/platformAccess.ts` is fully implemented and **called from nowhere** — verified: it
appears only in its own definition and `tests/platform-access-log.test.ts`. B1 connects it so
that every `platform_owner` read of a foreign organisation writes a `platform_access_log`
row. It stays non-fatal by design, which is correct for an audit trail: a missing line is a
smaller problem than an outage.

### 4.10 The banner

`ImpersonationBanner` already exists, is already non-dismissible, and already offers
«بازگشت به حساب خودم». Only its text changes, per Phase A §5.0, to name **both** facts — who
you are acting as, and in which world:

> در حال دیدن برنامه به‌جای **رضا احمدی**، نقش **راننده تحویل**. هر کاری که اینجا انجام دهید به نام او ثبت می‌شود.

### 4.11 Data flow

```
GET /api/admin/impersonatable?q=        all orgs, active users, grouped
  → switcher renders (A: in ProfileMenu, B: at /switch)

POST /api/admin/impersonate { user_id }
  ├─ requireRole: owner | platform_owner
  ├─ impersonationRefusal(...)                    pure, exhaustively tested
  ├─ mint token { uid, role: <primary>, act: <founder id> }
  ├─ founder's own token → rf_actor (httpOnly, 2h)
  ├─ emitEvent auth.impersonation_started  (actor = founder)
  └─ set both cookies

next request → session = the target, org = target's org
  ├─ proxy reads claims → target's world, target's tabs
  ├─ writes record actor_user_id = target, impersonated_by = founder
  ├─ cross-tenant reads additionally write platform_access_log
  └─ lib/session re-validates act is still an active platform_owner

DELETE /api/admin/impersonate → restore rf_actor, clear it, emit _ended
```

### 4.12 Failure modes

| Failure | Behaviour | Why |
|---|---|---|
| Founder deactivated or demoted mid-switch | `act` re-validation fails on the **next request** → signed out | An impersonation is only as valid as the actor behind it. Never a stale privileged session. |
| Target deactivated mid-switch | the switch survives (it is a real session, `token_version` checked) but they are no longer *offered* in the list | |
| Switch exceeds 2 hours | `IMPERSONATION_MAX_AGE_SECONDS` expires both cookies | Long enough to look around; short enough that a forgotten switch is not a month of being a salesperson. |
| Cross-tenant read | `platform_access_log` row; failure logged, never fatal | |
| Second `platform_owner` attempted | refused at the API and in `create-user.mjs` | P4 |

---

## 5. A second tenant (C)

There is exactly one organisation today (`طعمینو`) and one group (`رانندگان`). The
cross-tenant paths would ship **completely unexercised**, and would be found broken the day
customer two signs up.

`scripts/seed-demo.mjs` already establishes the right pattern — marker-based
(`sku LIKE 'DEMO-%'`, `username LIKE 'demo.%'`, `order_no LIKE '1404-9%'`) and reversible via
`--remove`, asserting `foreign_key_check` is clean before committing. **It hardcodes
`organization_id = 1` in ~15 places**, which is precisely the single-tenant assumption that
breaks.

New `scripts/seed-demo-org.mjs`:

- Creates **«شرکت پخش پارس»** (slug `pars`): groups and ~8 users — owner, group_manager,
  rep_manager, phone_sales, field_rep, two delivery_drivers.
- ~40 customers, ~30 leads with `saved_locations`, orders spread across several weeks,
  delivery runs with stops, visits, tasks, cheques — **history, not just rows**.
- Same `--remove` discipline, keyed on `organization_id`.
- **Never touches org 1**, asserted by a test comparing org 1's row counts before and after.

Then the cross-tenant paths have something to run against:

```ts
test("the founder can switch into another tenant's account", () => {
  expect(impersonationRefusal(founder, userIn("pars", "owner"))).toBeNull();
});
```

**Assumption:** all demo data is invented Persian business data. Nothing resembles طعمینو's
actual customers.

---

## 6. Testing

| Test | Asserts |
|---|---|
| `platform-owner-reach` | `platform_owner` reaches every route `owner` does, and is never a subset |
| `platform-owner-uniqueness` | exactly one `platform_owner`; creation of a second is refused by the API and by `create-user.mjs` |
| `impersonation` (extend) | cross-tenant allowed for `platform_owner`; still refused for `owner`; self-switch refused; deactivated target refused; the founder's own row not switchable |
| `impersonation-audit` (new) | a write under impersonation records **both** `actor_user_id` and `impersonated_by`; a write in god mode records the founder alone; a cross-tenant read writes `platform_access_log` |
| `actor-kill` (extend) | deactivating the founder mid-switch ends it on the next request |
| `seed-demo-org` | org 1 row counts identical before/after; `--remove` leaves `foreign_key_check` clean |
| `driver-notice` | a `platform_owner` on `/driver` and `/today` sees the notice, not a redirect; `owner` and `group_manager` still bounce |
| existing `appNav`, `proxy`, `roles` | kept green — the rename already in the working tree updates them |

---

## 7. Cost

| Step | Days | Difficulty |
|---|---|---|
| Commit the 215 uncommitted files | 0 | **DONE** — `c8489ed` + `1b343e7` (§2.1) |
| `MANAGE_ROLES` + the 189-site `tsc` sweep | 1–1.5 | low — compiler-guided |
| Page gates, `appNav`, the 5 `proxy.ts` branches | 0.5 | low — ~15 sites, hand-checked |
| `platform-owner-reach` + uniqueness tests | 0.5 | — this is the safety net |
| Founder → `{platform_owner, owner}`, refusal guards | 0.5 | low |
| `/driver` + `/today` notice, proxy exemption | 0.5 | low |
| `impersonationRefusal` widening + tests | 0.5 | low — pure function |
| `impersonated_by` on every write path + audit tests | 1–1.5 | **medium — the one change that touches many write paths** |
| `AccountSwitcher` component + `/api/admin/impersonatable` | 2–3 | medium — the only new screen |
| Mount at A and B | 0.5 | low — the component was built to be mounted twice |
| Banner text + `logPlatformAccess` wiring | 0.5 | low |
| `seed-demo-org.mjs` | 1–1.5 | low — touches no auth code |
| **Total (B1 + B2 + C)** | **9–12** | **on top of Phase A's 9–13** |

The largest single item is `impersonated_by`, not the 189-site sweep. Adding a column to every
write path sounds mechanical and is not quite — it is the difference between a record that is
true and one that quietly puts a person's name on work they did not do.

---

## 8. Out of scope

- **Building Phase A.** Specified separately, not built. Nothing here works without it.
- **A "view any driver's day" read-only mode.** P11 — the switcher already answers that
  question, with attribution.
- **Making `UNTOUCHABLE` configurable.** P4 ties it to uniqueness; a flag would let the two
  drift apart silently.
- **A second platform owner, or a per-switch read-only mode.** P6: the founder asked for full
  write access, and a read-only impersonation mode is a feature for a future role, not for
  this one.
- **Tenant self-service account switching.** This is a vendor support tool. Letting a tenant
  switch into their own staff accounts is a different product with different risks.
