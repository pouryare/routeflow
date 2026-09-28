# Multi-role people and the role switcher

**Date:** 2026-09-28
**Status:** approved design, ready for an implementation plan
**Revision 2 (2026-09-28):** a review pass against the code found that the first
draft's claim — *"the diff at the comparison sites is zero, and the proxy needs
no change"* — was **false**, and that it was hiding two larger classes of defect.
Corrected in §2.3, §3.3, §3.4, §4.6, §5.0 and §7.1, with §8 revised upward from
5–8 days to 9–13. The **design decision is unchanged**; what changed is the
blast radius. Anyone reading only the summary of D1–D10 should read §3.3 too.

**Touches:** `lib/roles.ts`, `lib/session.ts`, `lib/auth.ts`, `lib/appNav.ts`,
`lib/repo/briefing.ts`, `lib/orderStateMachine.ts`, `lib/repo/orders.ts`,
`lib/repo/syncMutations.ts`, `lib/repo/leadRuns.ts`, `lib/repo/pocket.ts`,
`lib/repo/crm/driverVisits.ts`, `lib/delivery.ts`, `lib/commissionLedger.ts`,
`lib/driverCommissionLedger.ts`, `lib/impersonation.ts`, `lib/db.ts`, `proxy.ts`,
`app/(bare)/today`, `app/(bare)/driver`, `app/api/me/role`,
`app/api/sales/runs`, `app/api/sales/commission/*`,
`components/meridian/ProfileMenu.tsx`, `scripts/create-user.mjs`

---

## 1. The problem

`users.role` is a single TEXT column, and the whole app asks one question of it:
*"which single role are you?"* Six roles answer it — `platform_owner`, `owner`,
`group_manager`, `rep_manager`, `salesperson`, `driver`.

That single question is currently doing two different jobs, and the business has
outgrown it.

**`driver` is one role doing two jobs.** A driver today receives delivery runs
(`delivery_runs`, `/driver`, `/api/driver/stops/[id]`) *and* field lead runs
(`lead_runs`, `/leads`, `/api/crm/driver-visits`, and `verify_visit` tasks with
`role_hint = 'driver'`). Nothing separates the two. `lib/delivery.ts:79` refuses
anyone whose role is not `driver`; `lib/repo/leadRuns.ts:256` selects
`WHERE role = 'driver'` to populate the "assign this route to" dropdown. So a
delivery driver can be handed a field-sales route, and a field rep cannot be
given deliveries.

**`salesperson` is misnamed.** It is a phone sales role and the Persian label
says only «فروشنده», which reads as "any seller".

**People hold more than one hat.** Someone who both drives a delivery round and
sells by phone has no role value that grants both, because the code asks "which
single role?" and then applies a **whitelist**:

```ts
// proxy.ts:196 — a whitelist, not a blacklist
if (claims.role === "driver" && !isDriver && !isSync && !isDriverBriefing) return deny("/driver");
```

Give that person `driver` and they lose the entire sales shell. Give them
`salesperson` and they lose every delivery. `lib/appNav.ts:85` has the matching
constraint — `if (r === "driver") return DRIVER_TABS` — a hand-written 3-tab list
rather than a filtered one, because a filter would leave 19 tabs the proxy would
redirect.

**A gap, deferred but designed for.** Cheques, credit approvals, commission
payouts and purchasing are gated to `owner` / `group_manager` because there is
no smaller role to hand them. Those jobs will be `accountant` and `warehouse`
roles when those people are hired. This design must make adding a role a data
change, not a code change.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A person's role becomes a **set** (`user_roles`), not a column | A person genuinely holds 2+ jobs. One column cannot say so. |
| D2 | Two tiers: `session.role` = **active role** (which world), `session.roles` = **full set** (what they may be assigned) | These are different questions and must be allowed to come apart |
| D3 | `driver` splits into `field_rep` + `delivery_driver`; existing drivers get **both** | Today's driver does both jobs; the migration must preserve their access exactly |
| D4 | `salesperson` → `phone_sales` | The name should say what the job is |
| D5 | A **role switcher** at `/today`, shown **only** to people with 2+ roles | Single-role staff must never see a new decision they didn't ask for |
| D6 | The two in-the-van roles share **one card**, but stay two roles underneath | They are one working day; they are separately assignable |
| D7 | `activeRole` lives in the **signed token** | `proxy.ts` has no DB access, so the claim is the only thing it can read |
| D8 | `users.role` is kept as the **primary role** | The fallback, and the escape hatch: set the primary and the picker never appears |
| D9 | A non-dismissible banner names the active role | Reuses `ImpersonationBanner`'s existing answer to "who am I acting as" |
| D10 | `accountant` / `warehouse` are **out of scope**, but the model must make them ~1 day | They are real future hires, and adding them must not need a redesign |

### 2.1 The role vocabulary

```
platform_owner      مدیر سامانه        support, across tenants
owner               مالک               this organisation
group_manager       مدیر گروه          one group's customers + orders
rep_manager         مدیر نمایندگان     the representative network
phone_sales         فروش تلفنی         was: salesperson
field_rep           ویزیتور میدانی     new, split from driver
delivery_driver     راننده تحویل       new, split from driver
```

`driver` is retired. Eight roles ship; `accountant` (حسابدار) and `warehouse`
(انباردار) are added later under the same shape.

### 2.2 The two tiers

```ts
interface Session {
  user: UserRow;
  role: Role;          // TIER 1 — the ACTIVE role: which world am I in?
  roles: Role[];       // TIER 2 — my FULL set: what may I be assigned?
  groupId: number | null;
  organizationId: number;
  actorId?: number;
}
```

| Question | Tier | Call sites |
|---|---|---|
| Which shell / nav / home page? | `session.role` | `appNav.ts`, `proxy.ts`, `homePathFor`, `app/(bare)` pages |
| May this person be handed a run? | `session.roles` | `leadRuns.assignableDrivers`, `delivery.createRun` |
| May they record the outcome? | `session.roles` | `crm/driverVisits`, `orderStateMachine` |

**The load-bearing consequence:** a person who is both field rep and delivery
driver taps **one** card. `activeRole = field_rep` puts them in the bare van
shell, while `hasRole("delivery_driver")` remains true, so deliveries still work
and they are still assignable for delivery runs. One screen, two separately
assignable capabilities — D6 satisfied without a merged-permission model.

### 2.3 What changes at the comparison sites, and why

`Session.role` keeps its name and its meaning-as-active-role, so the large
majority of `session.role === "..."` sites need no edit: `briefing.todayFor`'s
manager branches, `margin`, `why`, `board`, the group filters in `scopeGroupIds`.

**But not the role-literal gates. Those fail OPEN, which is the opposite of
safe.** `proxy.ts` compares the claim against role *literals*:

```ts
proxy.ts:109   if (isDriver && claims.role !== "driver") return deny("/sales");
proxy.ts:172   if (isCrm && !isDriverVisits && claims.role === "driver") return deny("/driver");
proxy.ts:173   if (isDriverVisits && claims.role !== "driver") return deny("/sales");
proxy.ts:196   if (claims.role === "driver" && !isDriver && !isSync && !isDriverBriefing) return deny("/driver");
```

With `field_rep` in the token every one of these is false, so every gate falls
through **open**: the driver whitelist at :196 never fires, and a field rep walks
into `/report`, `/sales/orders` and the whole sales shell. Line 173 likewise
opens `/api/crm/driver-visits` to a phone sales rep. This inverts the model —
today a driver provably cannot reach the debt ledger, and after a naive rename
they could, without anyone deciding it.

`lib/appNav.ts:85` has the same shape: `if (r === "driver") return DRIVER_TABS`
never fires, so a `field_rep` is handed the **full 19-tab sales menu** instead of
the 3-tab van list.

**So the rule is: a gate keyed on a role literal must become a set-membership
test.** In `lib/roles.ts`, which already exists to be the one place a role is
defined:

```ts
/** The two roles that work a route in a vehicle. A gate keyed on ONE of these
 *  literals falls open the moment the other appears, which is how a field rep
 *  ends up with the whole sales shell. */
export const VAN_ROLES: Role[] = ["field_rep", "delivery_driver"];
export function isVanRole(r: Role): boolean { return VAN_ROLES.includes(r); }
```

`proxy.ts` and `appNav.ts` then test membership. This is a small diff (six lines
in the proxy, one in `appNav`), but it is **not zero**, and it is
load-bearing.


---

## 3. Data model

### 3.1 `user_roles` — additive, no table rebuild

```sql
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, role FROM users;
INSERT OR IGNORE INTO user_roles SELECT id, 'field_rep'       FROM users WHERE role = 'driver';
INSERT OR IGNORE INTO user_roles SELECT id, 'delivery_driver' FROM users WHERE role = 'driver';
```

`users.role` stays, as the **primary role** (D8). No `CHECK` widening is needed
to store the new roles, because they live in `user_roles`. The `users` rebuild
in Step 4 exists only to keep the `CHECK` honest for the primary column.

**The backfill order matters, and the primary column follows it.** The three
statements above copy `users.role` verbatim first, *then* add the two split
roles for drivers. Rewriting `users.role` afterwards is what makes the column
agree with the set:

| `users.role` was | `users.role` becomes | Why |
|---|---|---|
| `salesperson` | `phone_sales` | a pure rename; the set has exactly one role, matching the column |
| `driver` | `delivery_driver` | a driver keeps both roles in `user_roles`; the column names one of them, and `delivery_driver` is the one whose app they land in by default |
| anything else | unchanged | |

A driver whose primary is `delivery_driver` and who also holds `field_rep` will,
on next login, land in the bare van shell (D5 routes a 2-role person to the
picker; §4.3 makes the van card their first option). A manager can promote
`field_rep` to primary for someone whose real job is field work.

⚠️ Because Step 1 backfills `users.role` into `user_roles` **before** the
rename, a driver backfilled as `driver` must also have the stale `'driver'` row
removed from `user_roles`, or a retired role name lives on in the set:

```sql
DELETE FROM user_roles WHERE role = 'driver';
```

Run that only after the two INSERTs above have run, and only once — it is the
point at which `driver` stops existing.

### 3.2 The trap: two role strings live in plain TEXT

`tasks.role_hint` and `task_rules.escalate_to_role` store a role name as an
unconstrained string. **Nothing in the type system knows this.** A rename that
passes `tsc clean` can silently stop routing tasks to people.

`lib/repo/rules.ts:501` resolves a rule's recipient with
`WHERE organization_id = ? AND role = ?`, so a stale value here means **a task
that nobody ever receives** — a missing notification, the hardest kind of failure
to notice.

**The `salesperson` values are mechanical** — one role maps to one role:

```sql
UPDATE tasks      SET role_hint         = 'phone_sales' WHERE role_hint = 'salesperson';
UPDATE task_rules SET escalate_to_role = 'phone_sales' WHERE escalate_to_role = 'salesperson';
```

**The `driver` values are NOT mechanical, and must not be blanket-replaced.**
`driver` covered two jobs, so each row has to be classified by what the task
actually is:

| The task is… | Becomes |
|---|---|
| a delivery / stop on a route | `delivery_driver` |
| a shop visit, a lead, a `verify_visit` | `field_rep` |

A `role_hint = 'driver'` row does not say which. So the migration is:

1. **List them first, before writing any UPDATE:**
   ```sql
   SELECT id, kind, title, entity_type, entity_id FROM tasks WHERE role_hint = 'driver';
   ```
2. **Decide each row by its `kind` and `entity_type`** — not by a blanket rule.
3. **Then apply**, per chosen value.

Expect a handful of rows. If a row cannot be classified, it should be assigned to
`field_rep` and flagged for review, because `role_hint` drives *offering* work
(`lib/repo/pocket.ts:55`) rather than granting access — a wrongly-offered task is
a manager's problem for one day, whereas a wrongly-*removed* task is work that
silently never happens.

`task_rules.escalate_to_role = 'driver'` is a different case: escalation names a
**role to hand the task to**, and an escalation is a judgement call about a stuck
task, not a delivery. Default those to `group_manager` (a manager always exists
to unstick it) and confirm each one:

```sql
UPDATE task_rules SET escalate_to_role = 'group_manager' WHERE escalate_to_role = 'driver';
```

Seeded defaults at `lib/db.ts:3720` and `:3742` also need updating.

### 3.3 The bigger trap: queries that read the role from the database

**A role set on `Session` is not enough.** A large class of code never reads the
session at all — it queries `users.role` directly. `grep "session.role ==="` does
not find any of these, which is exactly why they must be enumerated by hand.

Every row below goes **silent** on a naive rename. None throws; each simply
stops finding people.

| Site | Query | Symptom after a naive rename |
|---|---|---|
| `lib/repo/leadRuns.ts:256` | `WHERE role = 'driver'` | **Assign-route dropdown is empty.** No lead run can be handed to anyone. |
| `lib/repo/leadRuns.ts:229` | `if (u.role !== "driver") throw` | Every assignment rejected: «این کاربر راننده نیست» |
| `lib/delivery.ts:79` | `if (driver.role !== "driver") throw` | **No delivery run can ever be created.** |
| `app/api/sales/runs/route.ts:55` | `driver.role !== "driver"` | Same, from the API side |
| `lib/repo/syncMutations.ts:36` | `ORDER_ROLES.includes(u?.role)` | **The offline driver's best path dies.** Falls through to `"salesperson"`, so a driver in a van, offline, cannot `startRoute` or `deliver` — no error, just a button that does nothing. |
| `lib/repo/driverActivity.ts:25` | `WHERE role = 'driver'` | Driver-activity board reports zero drivers |
| `lib/repo/health.ts:329` | `WHERE role = 'driver'` | No driver health metrics computed |
| `lib/repo/health.ts:316` | `WHERE role = 'salesperson'` | **No seller health metrics at all** — the analytics board goes blank |
| `lib/repo/kpiSnapshots.ts:513` | `WHERE role = 'salesperson'` | Same, for KPI snapshots |
| `lib/commissionLedger.ts:235,238` | `WHERE role = 'salesperson'` | **No commission statements produced** for anyone |
| `lib/driverCommissionLedger.ts:228,230` | `WHERE role = 'driver'` | Driver commission statements empty |
| `app/api/sales/commission/rates/route.ts:57,89` | `role = 'driver'` / `'salesperson'` | Cannot set a commission rate for either kind |
| `app/api/sales/commission/payments/route.ts:56` | `role = ?` | Paying a commission fails |
| `lib/repo/pocket.ts:124` | `u.role IN ('salesperson','driver','rep_manager')` | Managers' team list loses phone sales **and both van roles** |
| `lib/repo/pocket.ts:45,58` | reads `u.role`, compares to `t.role_hint` | Unassigned role-hinted tasks go invisible — see §3.4 |
| `lib/repo/crm/driverVisits.ts:14` | `t.role_hint = 'driver'` | **Unassigned field visits disappear** |
| `lib/repo/crm/businesses.ts:162` | `u.role = 'salesperson'` | Seller dropdown for claiming a business is empty |
| `lib/repo/crm/migrate.ts:161` | `u.role IN ('salesperson',…)` | Customer↔rep backfill matches nobody |
| `lib/repo/rules.ts:501` | `WHERE role = ?` (escalation) | Escalations to a renamed role find no recipient |

`lib/repo/notifications.ts:153,178,189` also queries by role, but only for
`group_manager` / `owner`, which this change does not rename — it still needs
re-checking when `accountant` arrives.

**The governing rule, and the fix.** Any query whose *purpose* is "people who
can do X" must consult `user_roles`, not `users.role`:

```sql
-- before
SELECT id, display_name FROM users WHERE organization_id = ? AND role = 'delivery_driver' AND active = 1
-- after
SELECT u.id, u.display_name FROM users u
  JOIN user_roles r ON r.user_id = u.id
 WHERE u.organization_id = ? AND r.role = 'delivery_driver' AND u.active = 1
```

The distinction that keeps this cheap: a query that wants **one specific person
and their PRIMARY role** (`pocket.ts:45`, which asks "what is this person's
primary role, to match their unassigned task hints") keeps reading `users.role`
and needs no join. Only the *enumeration* queries — "all the drivers", "all the
sellers" — need the join. Widening the literal list instead of joining is
acceptable **only** where the role is the person's primary and the list is
cosmetic (a dashboard); it is **not** acceptable where the list feeds an
assignment control or a money calculation.

This table is the single largest item in the estimate, and it did not exist in
the first draft of this spec.

### 3.4 Two more places the two systems have to meet

**`role_hint` is a TEXT column, but it is queried against the active role.**
`pocket.ts:58` passes `u?.role ?? "salesperson"` into `t.role_hint = ?`, and
`driverVisits.ts:14` hardcodes `t.role_hint = 'driver'`. After §3.2 rewrites the
stored values to `phone_sales` / `field_rep`, a `field_rep` asks for
`role_hint = 'field_rep'` — which is correct — but a `delivery_driver` asking for
its own unassigned hints asks for `role_hint = 'delivery_driver'`, and those rows
were classified by hand in §3.2. So the migration and the query must agree, row
for row.

The safer shape is to stop treating `role_hint` as a single role and match it
against the **set**:

```sql
-- a task is offered to this person if its hint is any role they hold
AND (t.assignee_user_id = ? OR (t.assignee_user_id IS NULL AND EXISTS (
      SELECT 1 FROM user_roles r WHERE r.user_id = ? AND r.role = t.role_hint
    ) AND (t.group_id = ? OR t.group_id IS NULL)))
```

This makes the hand-classified rows forgiving: a task hinted `field_rep` is
offered to a driver who holds both, which is the intent. Adopt this in
`pocket.ts` and `driverVisits.ts`.

**The order state machine is single-role, and must become set-aware.**
`OrderRole` is a closed union —

```ts
// lib/orderStateMachine.ts:53
export type OrderRole = "salesperson" | "group_manager" | "owner" | "driver" | "system";
```

— and the guard is `lib/repo/orders.ts:189`:

```ts
if (!t.roles.includes(actor.role)) throw new OrderRoleError("نقش شما اجازهٔ این تغییر وضعیت را ندارد");
```

**This is the sharpest edge in the whole design, and the two-tier model is what
breaks it.** A `delivery_driver` whose *active* role is `field_rep` taps the
van card, then tries to mark a stop delivered. `actor.role` is `field_rep`,
`field_rep` is not in `OrderRole`, and the `deliver` edge lists `driver` — so the
delivery is **refused**, to the one person the design exists to serve. The
promise "they are still assignable for delivery runs" would be broken at the last
step, in a van, with a Persian error about their role.

The fix is to make the guard a set intersection, and to widen the two delivery
edges:

```ts
export type OrderRole = "phone_sales" | "group_manager" | "owner"
                     | "field_rep" | "delivery_driver" | "system";

// orders.ts:189
if (!t.roles.some((r) => actorRoles.includes(r))) throw new OrderRoleError(...);

// orderStateMachine.ts — the two delivery edges
{ from: "READY",            action: "startRoute",   roles: ["delivery_driver", "group_manager", "owner", "system"] },
{ from: "OUT_FOR_DELIVERY", action: "deliver",      roles: ["delivery_driver", "system"] },
```

`legalOrderActions(from, role)` and `canAdvanceOrder` take the same set, so the
buttons a person is *offered* agree with the transitions they may *fire* — the
same invariant `orders.ts:266` already cares about ("what `role` could do to
this order right now -- for rendering buttons").

⚠️ `lib/repo/syncMutations.ts:36` is the **worst** instance, because the driver
app is an offline client. `roleFor` reads the primary role from the database and
falls back to `"salesperson"` for anything unrecognised, so a `delivery_driver`
offline silently loses `startRoute` and `deliver`. It must read the full set.


---

## 4. The screens

### 4.1 The rule: single-role staff see nothing

```
roles.length === 1  →  skip the picker entirely, straight to homePathFor(role)
roles.length > 1   →  show the picker
```

This is the feature's main UX guarantee: it is invisible to single-role staff,
who are the majority.

### 4.2 The picker

Lives in `app/(bare)/today` — the bare layout is already the one-thumb,
no-chrome, non-blocking context built for a phone in a vehicle.

```
┌─────────────────────────────────┐
│                                 │
│   امروز چه کاری داری؟           │
│   انتخاب کنید                   │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 🛵  ویزیتور و راننده      │  │
│  │    ۴ تحویل  ·  ۶ بازدید      │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 📞  فروش تلفنی            │  │
│  │    ۱۲ تماس باز               │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

- **Counts on the card.** A card reading only «ویزیتور و راننده» makes the person
  think; «۴ تحویل · ۶ بازدید» tells them whether today is worth it before they
  tap. Two `COUNT` queries, and the difference between a menu and a decision aid.
- **One thumb.** Full-width cards, generous min-height and padding, per the
  constraint that produced the current `/driver` screen.
- **The choice sticks.** Once picked, they stay in that world until they pick
  the other. A picker on every page load is a punishment.

### 4.3 What each card opens

**«ویزیتور و راننده»** — `activeRole = field_rep`, bare van shell. The home
screen shows **both** panels: «تحویل‌های امروز» and «بازدیدهای امروز». Because
`hasRole("delivery_driver")` is true, `createRun` and the state machine still
work.

**«فروش تلفنی»** — `activeRole = phone_sales`, full sales shell, today's
`/sales/today` unchanged.

**Why one card for the van pair** (D6): they are one working day, and two cards
would mean choosing between "deliveries" and "visits" six times a shift — a
distinction with no operational meaning. The separation lives where it does
matter, in the assignment dropdowns: a manager assigning a **delivery run** sees
only people with `delivery_driver`; assigning a **lead run**, only `field_rep`.

### 4.4 The banner

Reuses the existing answer to the same hazard, with the same styling and the
same non-dismissible behaviour as `ImpersonationBanner`:

```tsx
<div className="actas" role="status">
  شما اکنون با نقش «ویزیتور و راننده» کار می‌کنید.
  [ تغییر نقش ]
</div>
```

No new visual language. Rendered for multi-role people only — a single-role
`accountant` or `warehouse` later needs no banner, because their nav already
says which app they are in.

### 4.5 Profile menu

`ProfileMenu.tsx:101` renders `roleLabel` as one line. It becomes a list, with a
«تغییر نقش» row above the existing links, shown only when `roles.length > 1`.

### 4.6 What changes and what does not

| Role | Nav | Home | API |
|---|---|---|---|
| `phone_sales` | identical | identical | identical |
| `delivery_driver` | identical to today's driver | identical `/driver` | identical |
| `field_rep` | **must equal** today's driver 3-tab list | new panel mix | new branch, same driver-visit queries |
| `owner`, `group_manager`, `rep_manager` | **unchanged** | **unchanged** | **unchanged** |

`field_rep`'s row reads "must equal", not "identical", because it only *becomes*
identical once §2.3's membership fix lands. Left alone, `appNav.ts:85` hands a
field rep the full 19-tab sales menu — a different app, reached by accident.

Management does not move at all: they are single-role, so they never see a
picker. The blast radius is confined to the field team that was already confused
by the current muddle.

⚠️ **`briefing.todayFor` has no fallback.** It is a chain of
`if (session.role === ...)` blocks ending in a bare `return` (`briefing.ts:267`).
A role with no branch gets **zero panels** — a person who logs in and sees
nothing, with no error anywhere. `field_rep` needs an explicit branch, and §7
adds a test that *every* role produces at least one panel, so the next role
cannot silently land here.


---

## 5. Data flow

```
POST /api/me/role  { role: "phone_sales" }
   │
   ├─ getSession(req)               authoritative: re-reads the user row
   ├─ loadRoles(userId)             SELECT role FROM user_roles
   ├─ if (!roles.includes(role)) → 403
   ├─ re-issue cookie with role: "phone_sales"
   └─ { ok: true }

next request → proxy.ts reads claims.role → correct world (D7)
             → getSession() loads roles[] from the DB → correct capabilities
```

`activeRole` lives in the signed token, not a side cookie, because `proxy.ts`
cannot read the database. Switching roles does **not** touch `token_version`, so
nobody is logged out, and an owner's Login-As impersonation survives a switch
(the `act` claim rides along).

### 5.0 Login-As, when the target has two roles

`lib/impersonation.ts` exists so an owner can answer "what does my person
actually see?" — and that question becomes ambiguous the moment someone holds
two roles. "What does Ali see?" has no single answer: as a driver he sees three
tabs, as a seller he sees nineteen.

The rules:

- **The impersonated session starts at the target's PRIMARY role**, so an owner
  lands where the person lands by default. It is not a random pick.
- **The owner can switch roles while impersonating**, using the same picker and
  the same endpoint. The `act` claim is preserved across the switch, so the
  banner still attributes every action to the target, and the existing
  `act` re-validation in `lib/session.ts:49-55` keeps working unchanged.
- **`UNTOUCHABLE` is unchanged** — `owner` and `platform_owner` still cannot be
  impersonated. A second hat does not make a manager impersonable, because the
  rule is about *authority*, not about how many roles someone holds.
- **The banner names both facts** — "you are seeing the app as Ali, as راننده
  تحویل" — so an owner reading over a shoulder is never confused about whose
  permissions they are exercising.

⚠️ `lib/impersonation.ts:23` currently reads the target's role as a single
value, and `impersonationRefusal` is a pure function over
`{id, role, organization_id, active}`. It needs the target's role **set** to
pick the primary correctly, and `UNTOUCHABLE` must be tested against every role
the target holds, not just the primary.

### 5.1 Failure modes

| Failure | Behaviour | Why |
|---|---|---|
| Stale cookie — admin removed a role, the 30-day cookie still names it | `getSession` sees the claim is not in the DB's role set, **falls back to the primary role**; the picker then shows the truth | The user row is re-read on every request, which `lib/session.ts:24` already states is why a demotion takes effect immediately rather than at expiry |
| Two people, one phone | The banner names the active role in words, non-dismissably | D9; same hazard as impersonation, same answer |
| Role removed mid-task | The in-flight task completes; the next write 403s | Writes re-check server-side, so nothing unauthorised lands. The failure is loud, not silent |

A role removed from someone's set takes effect **immediately** — the same
`token_version` principle, extended from the user row to the role set.

---

## 6. Migration

Five steps, each independently reversible, each with a test. `getDb()` runs
migrations on boot, so they are idempotent by construction.

**Step 1 — `user_roles` + backfill.** Invisible. Nobody loses access.

**Step 2 — the two TEXT columns.** §3.2. Invisible, and it repairs latent
mis-routing. Requires per-row judgement on the `driver` values.

**Step 3 — the rename, in two very different places.**

- **3a, the comparison sites** — ~125 string occurrences, ~139 `session.role`
  comparisons. `tsc`-guided and mechanical.
- **3b, the §3.3 queries** — nineteen sites that read `users.role` from the
  database. **These are the ones that break silently**, and they are what makes
  this step the largest. `delivery.createRun` and
  `leadRuns.assignableDrivers` are load-bearing for the entire delivery flow.
- **3c, the order state machine** — set-aware `OrderRole`, the two delivery edges,
  and `syncMutations.roleFor`, where the `?? "salesperson"` fallback would
  silently break the offline driver.
- **3d, the `role_hint` join** — `pocket.ts` and `driverVisits.ts`, so a task is
  offered on any role the person holds.

**Step 4 — the `users.role` `CHECK` widening.** The 5th table rebuild, after
backfill so nothing is lost if it fails. Follows the existing
`rebuildForTenantUnique` pattern.

**Step 5 — `activeRole`, the picker, the banner.** Purely additive. Carries four
prerequisites that must land *first*, because each is invisible until it is
missing:

| Prerequisite | Why it must precede the picker |
|---|---|
| §2.3 `VAN_ROLES` gates in `proxy` + `appNav` | Otherwise the picker grants a field rep the whole sales shell |
| §4.6 `field_rep` briefing branch | Otherwise a field rep logs in to an empty day |
| §3.4 set-aware `OrderRole` | Otherwise a delivery driver's own `deliver` is refused |
| §5.0 impersonation with a set | Otherwise Login-As on a two-role person picks the wrong world |

Steps 1–4 can ship without Step 5: the data model can be corrected in production
before any UI is exposed to a user.

### 6.1 Ship order

```
1. user_roles + backfill        invisible
2. TEXT column migration        invisible; fixes latent mis-routing
3. rename salesperson           invisible; no behaviour change
4. new role screens             field_rep / delivery_driver
5. activeRole + picker + banner the only user-visible step
6. accountant / warehouse       later, when hired
```

---

## 7. Testing

Each new role follows `tests/salesperson-role.test.ts`: the `CHECK` constraint
test, the "still rejects a role that is not real" test, and the `sqlite_master`
assertion that the rebuild actually happened.

| Test | Asserts |
|---|---|
| `tests/roles.test.ts` *(extend)* | the 8 roles; every label present; no orphan labels |
| `tests/user-roles-schema.test.ts` *(new)* | table exists; backfill idempotent; a driver got **both** roles; no `driver` row survives |
| `tests/role-migration.test.ts` *(new)* | no `role_hint` / `escalate_to_role` row still says `salesperson` or `driver` — **the guard against the §3.2 trap** |
| `tests/proxy.test.ts` *(rewrite the gate test)* | see below — the existing mirror test is insufficient |
| `tests/appNav.test.ts` *(extend)* | a `field_rep` gets **exactly** `DRIVER_TABS`, and does not get `/crm`, `/report` or `/sales/orders` |
| `tests/switch-role.test.ts` *(new)* | a role you do not hold → 403; a stale claim → fallback to primary; `token_version` untouched; `act` survives a switch |
| `tests/role-queries.test.ts` *(new)* | one case per §3.3 row: the enumeration returns a person who holds the role **non-primarily** |
| `tests/order-roles.test.ts` *(new)* | a `delivery_driver` with active role `field_rep` may fire `startRoute` and `deliver`; `legalOrderActions` agrees with what the guard permits |
| `tests/briefing.test.ts` *(extend)* | **every** role in `ROLES` produces ≥1 panel — catches the no-fallback branch |
| `tests/offline-driver.test.ts` *(new)* | an offline `delivery_driver` can `startRoute` and `deliver` via `syncMutations` — catches the `?? "salesperson"` fallback |

### 7.1 The existing proxy test cannot catch the §2.3 failure

`tests/proxy.test.ts:119` asserts one direction only:

```ts
for (const t of appTabs({ role: "driver" }).filter((x) => x.ready)) {
  expect(proxy(req(t.href, "driver")).status, t.href).toBe(200);
}
```

**Two files that are consistently wrong satisfy this.** If `appNav` hands a field
rep the sales menu *and* the proxy lets them through, the assertion passes — which
is precisely the §2.3 bug. The failing case is the one it never asks: a tab the
menu **hides** that the gate **admits**.

The replacement asserts both directions, per role:

```ts
for (const role of ROLES) {
  const shown = new Set(appTabs({ role }).filter((t) => t.ready).map((t) => t.href));
  for (const href of ["/crm", "/report", "/sales/orders", "/driver", "/leads"]) {
    const admitted = proxy(req(href, role)).status === 200;
    expect(admitted, `${role} → ${href}`).toBe(shown.has(href));
  }
}
```

Plus a direct assertion of intent, so a future reader cannot "fix" a failure by
loosening it:

```ts
expect(appTabs({ role: "field_rep" })).toEqual(appTabs({ role: "delivery_driver" }));
expect(proxy(req("/report", "field_rep")).status).not.toBe(200);
```

`tests/roles.test.ts:46` already parses `scripts/create-user.mjs` and asserts its
hardcoded list equals `ROLES`, so a forgotten copy in the bootstrap script fails
loudly rather than drifting.

---

## 8. Cost

| | Estimate | Difficulty |
|---|---|---|
| Step 1 — `user_roles` + backfill | 0.5 day | low — additive, no rebuild |
| Step 2 — the two TEXT columns | 0.5 day | low — plus the per-row `driver` judgement |
| Step 3a — rename in comparison sites | 1 day | low — `tsc`-guided, mechanical |
| **Step 3b — the §3.3 query audit** | **2–3 days** | **medium — 19 sites, and two of them (`delivery.createRun`, `leadRuns.assignableDrivers`) are load-bearing for the whole delivery flow** |
| Step 3c — the state machine + `syncMutations` | 1 day | medium — set-aware `OrderRole`, the offline path |
| Step 3d — `role_hint` ⇄ `user_roles` join | 0.5 day | low — two queries |
| Step 4 — the `users.role` `CHECK` rebuild | 0.5 day | low — the pattern already exists 4× |
| Step 5a — `VAN_ROLES` gates in `proxy` + `appNav` | 0.5 day | low, but **security-critical** |
| Step 5b — `field_rep` briefing branch | 0.5 day | low |
| Step 5c — impersonation with a set | 0.5 day | medium — a pure function and its callers |
| Step 5d — the picker, banner, `POST /api/me/role` | 2–3 days | medium — one screen, a cookie round-trip |
| **Total** | **9–13 days** | |
| Step 6 (accountant, warehouse) | ~1 day each, later | low — *because* of D1/D2 |

**The estimate went up from 5–8 days because the original number rested on a
false premise.** "Zero diff at the comparison sites" was asserted, and that
assertion is what hid §3.3 — nineteen queries that never touch the session. The
rename is genuinely cheap; the query audit is not, and it is the difference
between a system that keeps delivering and one where a driver in a van, offline,
silently cannot mark a stop delivered.

Two things soften it, and both are real: the §3.3 work is **mechanical once
enumerated** (this table is the enumeration), and Steps 1–4 still ship with no UI
at all, so the risky half can be corrected in production before a user sees
anything.

The final row of the table is still the point of the two-tier model: a future
role is a `ROLES` entry, a label, a nav branch, a briefing branch and a row in
§3.3. No migration, no rebuild, no new concept.

---

## 9. Out of scope

- **A merged single app.** Rejected: `proxy.ts`'s allowlist is a whitelist and
  cannot be unioned without dismantling it, and the driver app is deliberately
  chrome-free and offline-first — a van driver who also sells would load the
  full sales shell on mobile data.
- **A third management tier.** `group_manager` and `rep_manager` already exist; a
  fourth would turn the model to mush at this company size.
- **Splitting `owner`.** This is not a 600-person org.
- **An installer / technician role.** There is a hook in the cold-chain and
  batch code, but nothing in the codebase justifies it. Revisit if such people
  are hired.

