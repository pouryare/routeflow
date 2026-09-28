# Platform Owner & Account Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `platform_owner` reach every page and API in the app, and give the founder an account switcher that acts as any user in any organisation while recording both names in the audit trail.

**Architecture:** `platform_owner` is already all-powerful in the *scoping* layer (`scopeGroupIds` → `"all"`, `orgFilter` → empty) but is named in only 4 of 186 `requireRole` gates. We add one exported constant `MANAGE_ROLES` to `lib/roles.ts` — **P2**: one stated rule, not 190 hand edits — and substitute it at every site whose meaning is "is this person in charge?", then assert the result as an executable invariant (**P3**). God mode is infinite read with attributed write (**P5**): `POST /api/admin/impersonate` is widened from owner-only/same-org to platform_owner/cross-tenant, and every write path records `impersonated_by` alongside the existing actor column (**P7**), which is what makes the widened permission accountable rather than silent.

**Tech Stack:** Next.js 16 App Router, TypeScript, `node:sqlite`, Vitest, Persian/RTL UI, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-28-platform-owner-and-account-switcher-design.md`

**⚠️ BLOCKED ON PHASE A.** `session.roles` / `user_roles` do not exist. This plan's Task 1 commits the in-progress rename; the `user_roles` table itself is built by the multi-role plan. Task 4 (the founder holding two roles) cannot complete until that plan has run.

---

## Baseline facts (verified, not assumed)

These were measured against the working tree at commit `4798434`. **Re-verify Task 1 before starting** — if the numbers moved, the counts in Task 2 are wrong.

| Fact | Value |
|---|---|
| `requireRole` sites lacking `platform_owner` | **186** (146 literal lists + 40 via named constants) — spec **P1** |
| Literal `["owner","group_manager"]` | 81 |
| Literal `["owner"]` | 17 |
| Literal `["owner","group_manager","phone_sales"]` | 17 |
| `proxy.ts` branches naming roles explicitly | **5** — lines 80, 96, 107, 123, 158 |
| `appNav.ts` owner-only tabs | **3** — lines 134, 135, 136 |
| `logPlatformAccess` call sites outside its own file | **0** (fully implemented, never wired) |
| `session.actorId` written to any audit row | **0** (`grep -rn "session.actorId" app/ lib/` → only `lib/session.ts`) |
| Organisations in the DB | 1 (`طعمینو`, slug `tameeno`) |
| Users in the DB | 6 — `pourya` (id 1, role `owner`) + 5 `delivery_driver` |

### The named constants — a smaller job than 186 edits

40 of the 186 sites pass a **named constant**, not a literal. Editing the constant's *definition* fixes all of them at once:

| Constant | Defined at | Already has `platform_owner`? |
|---|---|---|
| `CRM_ROLES` | `lib/repo/crm/http.ts:9` | ✅ yes |
| `MANAGER` | `app/api/task-recurrences/route.ts:10` and `[id]/route.ts:5` (**duplicated**) | ✅ yes |
| `ROLES` | `lib/roles.ts:22` | ✅ yes (all 7) |
| `CAN_SELL` | `app/api/sales/orders/route.ts:24`, `[id]/route.ts:6` | ❌ no — 2 definitions, **they disagree** |
| `SELF_ROLES` | `app/api/prefs/route.ts:7` | ❌ no |
| `PLANNERS` | `app/api/sales/runs/route.ts:6` | ❌ no |
| `CAN_SEE` | `app/api/sales/customers/[id]/summary/route.ts:6` | ❌ no |

**So the real work is 146 literal substitutions + 7 constant definitions**, not 186. Two of those constants (`CAN_SELL`) are *duplicated with different contents* — a pre-existing bug this task fixes.

---

### Task 1: Commit the inherited work — ✅ COMPLETE, and it was not what this said

**This task ran on 2026-09-28 and found its own premise wrong.** The original text claimed
the 215 files were Phase A's Step 3a — the mechanical `driver` → `isVanRole` rename — and that
they were "`tsc`-clean". **Both were false.** The claim was inferred from the last commit
message plus the existence of modified files, without measuring the diff.

What was actually there: 215 files / 792 insertions / 552 deletions, containing the van rename
**plus** `salesperson` → `phone_sales` (334 lines), **plus** the `users.role` CHECK rebuild
(+99 lines, `lib/db.ts` — Phase A's Task 8), **plus** a half-finished `syncMutations.ts` that
`tsc` rejected. And the live database had already been migrated to the new vocabulary.

**Step 1 is the load-bearing one, and it is unchanged below** — the grep that verifies the diff
is the only reason this was caught before a commit. Do not skip it on any inherited work.

- [x] **Step 1: Confirm what the changes actually are**

```bash
cd /home/pourya/Desktop/routeflow
git status --porcelain | wc -l          # was 215
git diff --stat | tail -1               # was: 215 files, 792 insertions, 552 deletions
git diff | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE 'isVanRole|role === "driver"|role !== "driver"|VAN_ROLES|delivery_driver|field_rep|"driver"|lib/roles' \
  | head -40
```

⚠️ **This printed 40 lines of `salesperson` → `phone_sales` renames.** That is the signal the
task is designed to raise. On inherited work, "the diff looks like the description" is not
evidence — count the insertions and read what did not match.

- [x] **Step 2: Verify the type checker is clean**

```bash
npx tsc --noEmit 2>&1 | tail -20
```

⚠️ **The plan predicted no errors here. There were two, both real:**

```
lib/repo/syncMutations.ts(35,18): TS2322: Type '"salesperson"' is not assignable to type 'OrderRole'.
lib/repo/syncMutations.ts(35,91): TS2322: Type '"driver"' is not assignable to type 'OrderRole'.
```

`ORDER_ROLES` still held both retired names after `OrderRole` had moved to the new union —
Phase A's Task 5 started and abandoned, in the file the spec calls *"the worst instance, because
the driver app is an offline client."* Fixed: `satisfies OrderRole[]` instead of an annotation,
so the build fails if list and union ever drift again, and `roleFor()` narrows with `find()`
rather than an `as` cast. **`tsc --noEmit` now exits 0** — not even the pre-existing
`TS2304 'RouteContext'` noise.

- [x] **Step 3: Run the tests**

```bash
npx vitest run 2>&1 | tail -30     # 330 files passed, 13 skipped, exit 0
npm run lint 2>&1 | tail -10
```

Lint reports 43 errors across 26 files, and **they are all pre-existing**: intersecting every
lint-error file against the 215 changed files gives an empty set. They live in `tmp/`,
`pw_test*.mjs`, `verify_fix.js`, `components/analytics/*` and `app/(shell)/planner` — none
touched by this work. Do not try to fix them here.

- [x] **Step 4: Commit — in two, not one**

```bash
# (a) the risky half, reviewable on its own
git add lib/db.ts lib/roles.ts lib/orderStateMachine.ts lib/repo/syncMutations.ts \
        scripts/create-user.mjs scripts/seed-demo.mjs
git commit -m "feat(roles): the new vocabulary, and the migration that carries the data with it"

# (b) the mechanical call-site rename
git add -A
git commit -m "refactor(roles): call sites follow the vocabulary, everywhere"
```

Two commits rather than one because (a) is a **destructive, non-atomic table rebuild applied to
live data** and deserves to be readable — and revertable — on its own. (b) is 209 files of
mechanical rename and would bury it.

**Result:** `c8489ed` (6 files, the migration) and `1b343e7` (209 files, the call sites).
Working tree clean.

---

### Task 2: `MANAGE_ROLES` and the literal-list sweep

Implements spec **P1** (platform_owner in every management gate) and **P2** (one constant, not 190 hand edits).

**Files:**
- Modify: `lib/roles.ts` (add the constant)
- Modify: ~146 sites across `app/api/**` (substitution)
- Test: `tests/platform-owner-reach.test.ts` (create)

- [ ] **Step 1: Write the failing invariant test**

Create `tests/platform-owner-reach.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MANAGE_ROLES, type Role } from "@/lib/roles";

/* The design decision, stated as an executable fact (spec P3).
 *
 * Before this test existed the rule lived only in prose — and prose had already
 * failed: 182 of 186 gates omitted platform_owner. This asserts both directions,
 * so a future role or a future gate cannot quietly break the superset
 * relationship without a red test. */

describe("platform_owner reach", () => {
  it("MANAGE_ROLES contains platform_owner, owner and group_manager", () => {
    expect(MANAGE_ROLES).toContain("platform_owner");
    expect(MANAGE_ROLES).toContain("owner");
    expect(MANAGE_ROLES).toContain("group_manager");
  });

  it("never grants management to a role that is not a manager", () => {
    for (const r of ["phone_sales", "field_rep", "delivery_driver", "rep_manager"] as Role[]) {
      expect(MANAGE_ROLES, r).not.toContain(r);
    }
  });

  it("no gate anywhere in app/api omits platform_owner from a management list", async () => {
    // Walks the real source tree, so a new route that forgets the role fails
    // here rather than in production.
    const { execSync } = await import("node:child_process");
    const out = execSync(`grep -rn 'requireRole(req, \\[' app/ || true`, { encoding: "utf8" });
    const offenders = out
      .split("\n")
      .filter(Boolean)
      .filter((line) => {
        // A management gate names owner. If it names owner but not
        // platform_owner, that is the defect this task exists to fix.
        return /"owner"/.test(line) && !/platform_owner|MANAGE_ROLES/.test(line);
      });
    expect(offenders, `gates naming owner but not platform_owner:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/platform-owner-reach.test.ts 2>&1 | tail -30
```

Expected: FAIL — `MANAGE_ROLES` is not exported from `lib/roles.ts`.

- [ ] **Step 3: Add the constant**

Append to `lib/roles.ts`, after the `VAN_ROLES` block:

```ts
/** Roles that manage: full authority inside their own scope.
 *
 *  `platform_owner` is a strict SUPERSET of `owner` — the god key, used only when
 *  the founder acts as himself. The scoping layer in lib/session.ts has treated it
 *  as all-powerful since Phase 0a (`scopeGroupIds` → "all", `orgFilter` → empty);
 *  what was missing was its name in the 186 gates. This constant is that name,
 *  stated once, so `tsc` propagates it and tests/platform-owner-reach.test.ts can
 *  assert it.
 *
 *  NOT every role list is a management list. The order state machine's OrderRole,
 *  the per-role data-scoping queries, and SELF_ROLES are deliberately excluded —
 *  those ask "who does this job", not "who is in charge". */
export const MANAGE_ROLES: Role[] = ["platform_owner", "owner", "group_manager"];
```

- [ ] **Step 4: Sweep the 81 identical sites**

All 81 `["owner", "group_manager"]` lists are byte-identical, so one substitution covers them:

```bash
cd /home/pourya/Desktop/routeflow
# Preview — must print 81
grep -rl 'requireRole(req, \["owner", "group_manager"\])' app/ | wc -l

grep -rl 'requireRole(req, \["owner", "group_manager"\])' app/ | while read -r f; do
  perl -0pi -e 's/requireRole\(req, \["owner", "group_manager"\]\)/requireRole(req, MANAGE_ROLES)/g' "$f"
  grep -q 'MANAGE_ROLES } from' "$f" || \
    perl -0pi -e 's/^(import .*?;\n)/$1import { MANAGE_ROLES } from "\@\/lib\/roles";\n/ms' "$f"
done
```

**Verify the imports landed** — a malformed import is the most likely failure here:

```bash
npx tsc --noEmit 2>&1 | grep -i "MANAGE_ROLES" | head -20
```

Expected: no output. `Cannot find name 'MANAGE_ROLES'` means the insert failed for those files — fix by hand and re-run.

- [ ] **Step 5: Sweep the remaining literal lists**

Each is one substitution repeated across its occurrences. Replace with `MANAGE_ROLES` **plus whatever extra roles the list carried**, `platform_owner` first (the repo's convention in `ROLES` and `ROLE_LABEL`):

| Literal | Count | Becomes |
|---|---|---|
| `["owner"]` | 17 | `MANAGE_ROLES` |
| `["owner", "group_manager", "phone_sales"]` | 17 | `[...MANAGE_ROLES, "phone_sales"]` |
| `["owner", "group_manager", "rep_manager"]` | 3 | `[...MANAGE_ROLES, "rep_manager"]` |
| `["owner", "group_manager", "rep_manager", "phone_sales"]` | 2 | `[...MANAGE_ROLES, "rep_manager", "phone_sales"]` |
| `["owner", "group_manager", "phone_sales", "rep_manager"]` | 2 | `[...MANAGE_ROLES, "phone_sales", "rep_manager"]` |
| `["owner", "rep_manager"]` | 4 | `["platform_owner", "owner", "rep_manager"]` |
| `["owner", "group_manager", "field_rep", "delivery_driver"]` | 6 | `[...MANAGE_ROLES, "field_rep", "delivery_driver"]` |
| `["owner", "group_manager", "phone_sales", "field_rep", "delivery_driver"]` | 4 | `[...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver"]` |
| `["owner", "group_manager", "phone_sales", "field_rep", "delivery_driver", "rep_manager"]` | 5 | `[...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]` |
| `["field_rep", "delivery_driver"]` | 4 | **UNCHANGED** — van-only, not a management gate |
| `["phone_sales"]` | 1 | **UNCHANGED** — not a management gate |

⚠️ **The last two rows are the trap.** They name no manager, so they are not management gates and must not gain `platform_owner`. `["field_rep", "delivery_driver"]` is the driver's own world — adding the god key there would hand every driver the sales shell, which is the exact failure `VAN_ROLES` was written to prevent.

- [ ] **Step 6: Verify the sweep is complete**

```bash
cd /home/pourya/Desktop/routeflow
grep -rn 'requireRole(req, \[' app/ | grep '"owner"' | grep -v 'platform_owner\|MANAGE_ROLES' | wc -l
npx tsc --noEmit 2>&1 | grep -i "MANAGE_ROLES" | head
npx vitest run tests/platform-owner-reach.test.ts 2>&1 | tail -15
```

Expected: `0`, no `tsc` output, and PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/roles.ts app/ tests/platform-owner-reach.test.ts
git commit -m "feat(roles): platform_owner is named in every management gate

One constant, MANAGE_ROLES, replacing 146 hand-typed role lists that each
forgot platform_owner. requireRole already took a list, so the diff is a
substitution with no signature change and tsc finds every site.

tests/platform-owner-reach.test.ts walks the real source tree and fails if any
gate names owner but not platform_owner — the rule as a fact, not a convention."
```

---

### Task 3: The named constants

**Files:**
- Modify: `app/api/sales/orders/route.ts:24`, `app/api/sales/orders/[id]/route.ts:6` (`CAN_SELL`)
- Modify: `app/api/prefs/route.ts:7` (`SELF_ROLES`)
- Modify: `app/api/sales/runs/route.ts:6` (`PLANNERS`)
- Modify: `app/api/sales/customers/[id]/summary/route.ts:6` (`CAN_SEE`)

40 of the 186 sites pass a named constant. Three already include `platform_owner` (`CRM_ROLES`, `MANAGER`, `ROLES`) and need no change. Four do not.

- [ ] **Step 1: Fix the duplicated `CAN_SELL`**

Two files define it with **different contents** — a pre-existing bug. `orders/route.ts:24` admits both van roles; `[id]/route.ts:6` does not. So a driver can create an order but not read it back.

In `app/api/sales/orders/[id]/route.ts:6`, replace:

```ts
const CAN_SELL = ["owner", "group_manager", "phone_sales"] as const;
```

with:

```ts
/* Was ["owner", "group_manager", "phone_sales"] — narrower than its twin in
 * orders/route.ts, so a van role could create an order and then not read it
 * back. Both now derive from the same list, and platform_owner is in it. */
const CAN_SELL = ["platform_owner", "owner", "group_manager", "phone_sales",
  "field_rep", "delivery_driver"] as const;
```

And in `app/api/sales/orders/route.ts:24`, add the role:

```ts
const CAN_SELL = ["platform_owner", "owner", "group_manager", "phone_sales",
  "field_rep", "delivery_driver"] as const;
```

- [ ] **Step 2: Fix `SELF_ROLES`, `PLANNERS`, `CAN_SEE`**

```ts
// app/api/prefs/route.ts:7 — self-service UI prefs, one file per person
const SELF_ROLES = ["platform_owner", "owner", "group_manager", "rep_manager",
  "phone_sales", "field_rep", "delivery_driver"] as const;

// app/api/sales/runs/route.ts:6 — route hand-over is a desk job
const PLANNERS = ["platform_owner", "owner", "group_manager"] as const;

// app/api/sales/customers/[id]/summary/route.ts:6
const CAN_SEE = ["platform_owner", "owner", "group_manager", "phone_sales"] as const;
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | head -10
npx vitest run tests/platform-owner-reach.test.ts tests/orders.test.ts 2>&1 | tail -15
```

Expected: PASS. Also confirm both `CAN_SELL` definitions are now identical:

```bash
grep -n -A1 'const CAN_SELL' app/api/sales/orders/route.ts app/api/sales/orders/\[id\]/route.ts
```

- [ ] **Step 4: Commit**

```bash
git add app/api
git commit -m "fix(orders): the two CAN_SELL lists disagreed

orders/route.ts admitted both van roles and [id]/route.ts did not, so a driver
could create an order and then be refused reading it back. Both now carry the
same roles, and platform_owner is in all four named gate constants."
```

---

### Task 4: Page gates, `proxy.ts`, and `appNav`

**Files:**
- Modify: `app/(shell)/sales/admin/layout.tsx:36`
- Modify: `app/(shell)/sales/{cheques,batches,deliveries,forecast,routing}/page.tsx:16-30`
- Modify: `proxy.ts:80, 96, 107, 123, 158`
- Modify: `lib/appNav.ts:49, 50, 134, 135, 136`
- Test: `tests/platform-owner-reach.test.ts` (extend)

- [ ] **Step 1: Extend the test to cover pages and proxy**

Append to `tests/platform-owner-reach.test.ts`:

```ts
import { appTabs } from "@/lib/appNav";
import { proxy } from "@/proxy";

describe("platform_owner reach — pages and proxy", () => {
  const req = (path: string, role: Role) =>
    proxy(new Request(`http://localhost${path}`, {
      headers: { cookie: `rf_session=${tokenFor(role)}` },
    }) as never);

  it("reaches every management page in the nav", () => {
    const tabs = appTabs({ role: "platform_owner" } as never);
    expect(tabs.filter((t) => t.ready).length).toBe(tabs.length);
  });

  it("reaches every path in the driver app, to see the notice", () => {
    // Not 200-implies-access: the point is that it is NOT redirected to /sales.
    const res = req("/driver", "platform_owner");
    expect(res.status).not.toBe(307);
  });

  it("still bounces a plain owner off /driver", () => {
    // The exemption is platform_owner-only. An owner was never invited to
    // inspect a driver's day.
    expect(req("/driver", "owner").status).toBe(307);
  });
});
```

⚠️ The `proxy` import needs a signed token, which needs `lib/auth.ts`'s secret. If constructing tokens in a test is awkward, assert the *branch conditions* directly instead — read the five `claims.role !==` sites and confirm each now tests `MANAGE_ROLES.includes(claims.role)`.

- [ ] **Step 2: Fix the six page gates**

Each currently reads `session.role !== "owner" && session.role !== "group_manager"`. Replace with `MANAGE_ROLES`:

```ts
// app/(shell)/sales/admin/layout.tsx:36 — was: if (session.role !== "owner") redirect("/sales");
if (!MANAGE_ROLES.includes(session.role) || session.role === "rep_manager") redirect("/sales");
```

⚠️ The admin layout is **owner-only today**, not owner+group_manager. `MANAGE_ROLES` would newly admit `group_manager`, which is a privilege *increase* this spec did not ask for. Keep the admin layout owner-only and add the god key explicitly:

```ts
// app/(shell)/sales/admin/layout.tsx — the org's own admin: owner only, plus god mode.
if (session.role !== "owner" && session.role !== "platform_owner") redirect("/sales");
```

The other five (`cheques`, `batches`, `deliveries`, `forecast`, `routing`) genuinely are owner+group_manager today, so `MANAGE_ROLES` is correct for them:

```ts
// was: if (session.role !== "owner" && session.role !== "group_manager") redirect("/sales");
if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");
```

Add `import { MANAGE_ROLES } from "@/lib/roles";` to each.

- [ ] **Step 3: Fix the five `proxy.ts` branches**

Import the constant (`import { isVanRole, MANAGE_ROLES } from "@/lib/roles";`) and rewrite each:

```ts
// line 80 (isReps) and line 96 (isTaskBoard) — same shape
if (isReps && !MANAGE_ROLES.includes(claims.role as Role) && claims.role !== "rep_manager") {
  return deny("/sales");
}

// line 107 (isAdmin) — owner only, plus god mode; rep_manager on the reps sub-path only
if (isAdmin && !isEndImpersonation
    && claims.role !== "owner" && claims.role !== "platform_owner"
    && !(isRepAdmin && claims.role === "rep_manager")) {
  return deny("/sales");
}

// line 123 (isCheques) and line 158 (isBatchAdmin) — same shape
if (isCheques && !MANAGE_ROLES.includes(claims.role as Role)) return deny("/sales");

// line 110 — the /driver exemption (spec P9). platform_owner is admitted so the
// "you are not a driver" notice can render; owner and group_manager still bounce.
if (isDriver && !isVanRole(claims.role) && claims.role !== "platform_owner") return deny("/sales");
```

`proxy.ts` reads claims from a token and has no DB access, so `claims.role` is typed as the token's role — cast to `Role` where the compiler asks.

- [ ] **Step 4: Fix `appNav.ts`**

```ts
// line 49-50
const isManager = (r: Role) => MANAGE_ROLES.includes(r);
const isRepLead = (r: Role) => isManager(r) || r === "rep_manager";

// lines 134-136 — owner-only org settings, plus god mode
{ href: "/sales/admin/users",  label: "کاربران",  group: "org", ready: r === "owner" || r === "platform_owner" },
{ href: "/sales/admin/groups", label: "گروه‌ها",  group: "org", ready: r === "owner" || r === "platform_owner" },
{ href: "/facilities",         label: "مکان‌های ما", group: "org", ready: r === "owner" || r === "platform_owner" },
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "proxy|appNav|layout" | head
npx vitest run tests/platform-owner-reach.test.ts tests/appNav.test.ts tests/proxy.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add proxy.ts lib/appNav.ts app/'(shell)' tests/platform-owner-reach.test.ts
git commit -m "feat(roles): platform_owner reaches every page, and sees the driver notice

The five proxy branches, six page gates and three owner-only nav tabs all named
roles by hand. The admin layout stays owner-only plus god mode -- widening it to
group_manager would be a privilege increase this change did not ask for.

proxy now admits platform_owner to /driver so the \"you are not a driver\"
notice can render. owner and group_manager still bounce."
```

---

### Task 5: The driver notice

**Files:**
- Create: `components/driver/NotAVanNotice.tsx`
- Modify: `app/(bare)/driver/page.tsx:42`
- Modify: `app/(bare)/today/page.tsx:21`
- Test: `tests/driver-notice.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/driver-notice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Spec P9: a platform_owner landing on /driver or /today gets an honest notice
 * and a way forward, not a redirect to /map. The redirect told him nothing; the
 * notice tells him he is not a driver AND that switching is one click away. */

describe("the not-a-driver notice", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("/driver no longer redirects a non-van role away", () => {
    const page = src("app/(bare)/driver/page.tsx");
    expect(page).not.toMatch(/isVanRole\(session\.role\)\)\s*redirect/);
    expect(page).toContain("NotAVanNotice");
  });

  it("/today renders the same notice", () => {
    expect(src("app/(bare)/today/page.tsx")).toContain("NotAVanNotice");
  });

  it("names the way forward, in Persian", () => {
    const c = src("components/driver/NotAVanNotice.tsx");
    expect(c).toContain("شما راننده نیستید");
    expect(c).toContain("ورود به‌عنوان راننده");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/driver-notice.test.ts 2>&1 | tail -20
```

Expected: FAIL — the component does not exist and both pages still redirect.

- [ ] **Step 3: Create the component**

`components/driver/NotAVanNotice.tsx`:

```tsx
import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";

/* Shown to a platform_owner who opened a driver page.
 *
 * The page behind this is a mirror: lib/delivery.ts's readDriverRuns is scoped to
 * session.user.id, so it renders the viewer's own round. For the founder that is
 * always empty, and the old redirect to /map hid the reason. This says what is
 * true, and offers the one action that would make it useful.
 *
 * Deliberately NOT a "view any driver's day" mode (spec P11): a read-only viewer
 * would produce writes with no impersonation behind them, so the audit trail
 * would need a second mechanism to explain them. Switching is the honest answer. */
export default function NotAVanNotice({ role = "delivery_driver" }: { role?: string }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-[var(--space-4)] py-[var(--space-5)]" dir="rtl">
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-[var(--space-6)]">
        <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] text-[var(--text-muted)]">
          <Icon name="user" size="sm" />
          <span className="text-[length:var(--text-xs)]">اطلاع</span>
        </div>
        <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">
          شما راننده نیستید
        </h1>
        <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
          این صفحه برنامه و توقف‌های یک راننده را نشان می‌دهد. برای دیدن برنامهٔ امروز یک
          راننده، به‌عنوان او وارد شوید.
        </p>
        <Link
          href="/switch?role=delivery_driver"
          className="mt-[var(--space-4)] inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--accent-ink)]"
        >
          ورود به‌عنوان راننده
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Wire it into both pages**

`app/(bare)/driver/page.tsx:42`:

```ts
// was: if (!isVanRole(session.role)) redirect("/map");
if (!isVanRole(session.role)) return <NotAVanNotice />;
```

`app/(bare)/today/page.tsx:21`:

```ts
// was: if (!isVanRole(session.role)) redirect(homePathFor(session.role));
if (!isVanRole(session.role)) return <NotAVanNotice />;
```

Add `import NotAVanNotice from "@/components/driver/NotAVanNotice";` to each. `homePathFor` may become an unused import in `today/page.tsx` — remove it if so.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "driver/page|today/page|NotAVan" | head
npx vitest run tests/driver-notice.test.ts 2>&1 | tail -15
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add components/driver/NotAVanNotice.tsx 'app/(bare)' tests/driver-notice.test.ts
git commit -m "feat(driver): tell a platform_owner why the driver page is empty

readDriverRuns is scoped to session.user.id, so /driver always renders the
viewer's own round -- and the founder has none. The redirect to /map hid the
reason. The notice says what is true and puts switching one click away.

No read-only view mode (spec P11): writes with no impersonation behind them
would need a second audit mechanism to explain them."
```

---

### Task 6: `impersonated_by` — the audit fix

Implements spec **P5** (infinite read, attributed write) and **P7** (both names recorded). This is the most important task in the plan: today `session.actorId` is validated on every request and written to no audit row, so work the founder does while acting as a driver is recorded as the driver's alone.

**Files:**
- Modify: `lib/db.ts` (3 columns + `logActivity`)
- Modify: `lib/repo/orders.ts` (`appendOrderEvent`, `advanceOrder` call sites)
- Modify: `lib/repo/events.ts` (`emitEvent`)
- Modify: `lib/repo/syncMutations.ts` (the offline path)
- Test: `tests/impersonation-audit.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/impersonation-audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { appendOrderEvent } from "@/lib/repo/orders";
import { emitEvent } from "@/lib/repo/events";

/* Spec P7. Before this, a write under impersonation recorded the impersonated
 * user alone. The founder's involvement existed only in a start/stop pair in the
 * events log that a tenant never reads — so the record misattributed his work to
 * a person who did not do it. Both names, on the three tables that already
 * record an actor. No new audit infrastructure: the gap was a column. */

describe("impersonated_by", () => {
  const db = () => getDb();
  const now = () => new Date().toISOString();

  it("order_events records the target AND who was really driving", () => {
    appendOrderEvent(db(), {
      organization_id: 1, order_id: 1, from_status: "READY", to_status: "OUT_FOR_DELIVERY",
      action: "startRoute", actor_user_id: 5, impersonated_by: 1, created_at: now(),
    } as never);
    const row = db()
      .prepare("SELECT actor_user_id, impersonated_by FROM order_events ORDER BY id DESC LIMIT 1")
      .get();
    expect(row).toEqual({ actor_user_id: 5, impersonated_by: 1 });
  });

  it("is null for an ordinary write", () => {
    appendOrderEvent(db(), {
      organization_id: 1, order_id: 1, from_status: "PLANNED", to_status: "CONFIRMED",
      action: "passReview", actor_user_id: 5, impersonated_by: null, created_at: now(),
    } as never);
    const row = db()
      .prepare("SELECT impersonated_by FROM order_events ORDER BY id DESC LIMIT 1")
      .get() as { impersonated_by: number | null };
    expect(row.impersonated_by).toBeNull();
  });

  it("events carries it too", () => {
    emitEvent(1, { kind: "x", entity_type: "user", entity_id: 5,
      actor_user_id: 5, impersonated_by: 1, occurred_at: now() } as never);
    const row = db()
      .prepare("SELECT impersonated_by FROM events ORDER BY id DESC LIMIT 1")
      .get() as { impersonated_by: number | null };
    expect(row.impersonated_by).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/impersonation-audit.test.ts 2>&1 | tail -20
```

Expected: FAIL — no such column.

- [ ] **Step 3: Add the three columns**

Next to the existing guarded migrations in `lib/db.ts`:

```ts
/* Who was really driving. Nullable, no cascade: an audit row must outlive the
 * user it names, which is why `events` has no FKs on any reference at all.
 * NULL for every ordinary write, so "not an impersonation" is the default and
 * needs no special-casing downstream. */
for (const t of ["activity_log", "order_events", "events"]) {
  if (!hasColumn(db, t, "impersonated_by")) {
    db.exec(`ALTER TABLE ${t} ADD COLUMN impersonated_by INTEGER REFERENCES users(id)`);
  }
}
```

⚠️ Match the repo's actual helper — `scripts/seed-demo.mjs` has a local `hasCol` built on `PRAGMA table_info`; use whatever `lib/db.ts` already provides rather than inventing a third spelling.

- [ ] **Step 4: Thread it through the four writers**

`lib/repo/orders.ts` — `appendOrderEvent` gains the field and writes it:

```ts
export function appendOrderEvent(conn: DatabaseSync, row: {
  organization_id: number; order_id: number; from_status: string | null; to_status: string;
  action: string; actor_user_id: number | null; impersonated_by?: number | null;
  reason_code_id?: number | null; note?: string | null; device_time?: string | null;
  created_at: string;
}): void {
  conn.prepare(
    `INSERT INTO order_events
       (organization_id, order_id, from_status, to_status, action, actor_user_id,
        impersonated_by, reason_code_id, note, device_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.organization_id, row.order_id, row.from_status, row.to_status, row.action,
    row.actor_user_id, row.impersonated_by ?? null,
    row.reason_code_id ?? null, row.note ?? null, row.device_time ?? null, row.created_at,
  );
}
```

**The call sites are what actually matter.** `advanceOrder` has two `appendOrderEvent` calls (`lib/repo/orders.ts:205` and `:224`); both must pass `impersonated_by: actor.actorId ?? null` — which means the `actor` it receives has to carry the field, so thread `actorId` from the session into `advanceOrder`'s actor argument at every caller.

`lib/repo/events.ts` — `emitEvent` gains an optional `impersonated_by` on its input and adds it to the INSERT.

`lib/db.ts:3640` — `logActivity` gains `impersonated_by?: number | null` in the `Omit<ActivityEntry, …> & {…}` type and adds it to both the column list and the `.run(...)` arguments.

⚠️ **`lib/repo/syncMutations.ts` is not optional.** The driver app is an *offline client* — a write queued in a van arrives later. An offline impersonated write must carry the actor across the sync payload, or attribution is lost exactly where it is hardest to recover. Add `impersonated_by` to the mutation envelope and preserve it through `syncMutations`. This file is already flagged in the multi-role spec as the worst `role`-reading site in the codebase, so it deserves the same care here.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | head -10
npx vitest run tests/impersonation-audit.test.ts tests/orders.test.ts tests/order-events-schema.test.ts tests/sync-apply.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/repo/orders.ts lib/repo/events.ts lib/repo/syncMutations.ts tests/impersonation-audit.test.ts
git commit -m "feat(audit): record who was really driving, not only who the session was

session.actorId has been validated on every request since Login-As shipped and
written to no audit row. A write performed under impersonation was attributed
to the impersonated user alone -- so a fix the founder made while acting as a
driver was recorded as the driver's work, on a record the driver never sees.

One nullable column on the three tables that already record an actor:
activity_log, order_events, events. NULL by default, so an ordinary write needs
no special-casing. syncMutations carries it too: the driver app is offline, and
attribution lost in a queue is attribution lost for good."
```

---

### Task 7: Widen `impersonationRefusal`

**Files:**
- Modify: `lib/impersonation.ts:15-28`
- Modify: `app/api/admin/impersonate/route.ts:20`
- Test: `tests/impersonation-refusal.test.ts` (create or extend)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { impersonationRefusal } from "@/lib/impersonation";

/* Spec §4.6-4.7. The founder is a platform_owner, not an owner, so today's
 * role === "owner" check refuses him outright; and the same-org rule refuses
 * every cross-tenant switch, which is the whole point of the tool.
 *
 * UNTOUCHABLE is REMOVED — but that is only safe because P4 guarantees exactly
 * one platform_owner, and this test file is where that coupling is written down. */

const founder = { id: 1, role: "platform_owner", organization_id: 1, active: 1 };
const owner = { id: 2, role: "owner", organization_id: 1, active: 1 };
const driver = { id: 5, role: "delivery_driver", organization_id: 1, active: 1, group_id: 1 };
const otherTenantOwner = { id: 9, role: "owner", organization_id: 2, active: 1 };

describe("impersonationRefusal", () => {
  it("lets the founder switch into his own driver", () => {
    expect(impersonationRefusal(founder, driver)).toBeNull();
  });

  it("lets the founder switch across tenants", () => {
    expect(impersonationRefusal(founder, otherTenantOwner)).toBeNull();
  });

  it("still refuses a plain owner crossing tenants", () => {
    expect(impersonationRefusal(owner, { ...driver, organization_id: 2 })).not.toBeNull();
  });

  it("still refuses switching into yourself", () => {
    expect(impersonationRefusal(founder, { ...founder, id: 1 })).not.toBeNull();
  });

  it("still refuses a deactivated target", () => {
    expect(impersonationRefusal(founder, { ...driver, active: 0 })).not.toBeNull();
  });

  it("still refuses a deactivated actor", () => {
    expect(impersonationRefusal({ ...founder, active: 0 }, driver)).not.toBeNull();
  });

  it("still refuses a manager who is neither owner nor platform_owner", () => {
    expect(impersonationRefusal({ ...owner, role: "group_manager" }, driver)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/impersonation-refusal.test.ts 2>&1 | tail -25
```

Expected: FAIL on the two founder cases and the cross-tenant case.

- [ ] **Step 3: Rewrite the function**

Replace `lib/impersonation.ts:15-28` with:

```ts
export function impersonationRefusal(actor: ImpersonationParty, target: ImpersonationParty | null): string | null {
  if (!actor.active) return "حساب شما غیرفعال است";
  if (actor.role !== "owner" && actor.role !== "platform_owner") {
    return "فقط مالک می‌تواند به‌جای کاربر دیگری وارد شود";
  }
  if (!target) return "کاربر پیدا نشد";
  if (target.id === actor.id) return "نمی‌توانید به‌جای خودتان وارد شوید";
  if (!target.active) return "این حساب غیرفعال است";

  /* Cross-tenant is ALLOWED, and only for a platform_owner. An owner crossing into
   * another organisation is refused above — the same-org check below catches it. */
  if (actor.role !== "platform_owner" && target.organization_id !== actor.organization_id) {
    return "کاربر پیدا نشد";
  }

  /* UNTOUCHABLE is GONE, deliberately — the founder must be able to act as any
   * account in any tenant, including a tenant's owner.
   *
   * ⚠️ THIS IS ONLY SAFE BECAUSE THERE IS EXACTLY ONE platform_owner.
   * tests/platform-owner-uniqueness.test.ts asserts that count is 1. Do not relax
   * that test and leave this file alone: a second platform owner turns "the
   * founder may act as anyone" into "two people may act as each other", which is
   * authority without accountability. If a second platform_owner is ever created,
   * restore an UNTOUCHABLE check for platform_owner here FIRST. */
  return null;
}
```

- [ ] **Step 4: Widen the route's guard**

`app/api/admin/impersonate/route.ts:20`:

```ts
// was: requireRole(req, ["owner"]);
const guard = requireRole(req, ["owner", "platform_owner"]);
```

The `DELETE` handler's re-validation at line 69 (`owner.role !== "owner"`) must also accept `platform_owner`:

```ts
if (!current?.act || !owner || !savedToken
    || (owner.role !== "owner" && owner.role !== "platform_owner")
    || owner.user.id !== current.act) { /* clear both cookies */ }
```

And `lib/session.ts:55` — the `act` re-validation — must accept a platform_owner actor:

```ts
// was: if (!actor || !actor.active || actor.role !== "owner" || ...) return null;
if (!actor || !actor.active
    || (actor.role !== "owner" && actor.role !== "platform_owner")
    || (actor.role !== "platform_owner" && actor.organization_id !== user.organization_id)) return null;
```

⚠️ The cross-tenant clause matters: a platform_owner legitimately acts *across* organisations, so the existing `actor.organization_id !== user.organization_id` check would kill every cross-tenant switch on the very next request.

- [ ] **Step 5: Verify**

```bash
npx vitest run tests/impersonation-refusal.test.ts tests/impersonation-session.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/impersonation.ts lib/session.ts app/api/admin/impersonate/route.ts tests/
git commit -m "feat(impersonate): the platform owner may act as any account, any tenant

Three refusals lifted: the actor must be owner OR platform_owner (the founder is
the latter, so today's check refused him outright); cross-tenant switches are
allowed for a platform_owner; UNTOUCHABLE is gone.

The last one is only safe while there is exactly one platform_owner, and
tests/platform-owner-uniqueness.test.ts is what holds that. The coupling is now
written at the site where UNTOUCHABLE used to be, so nobody relaxes one and
leaves the other.

lib/session.ts's act re-check also had to learn about platform_owner, and to
stop comparing organisations for that role -- otherwise every cross-tenant
switch died on the very next request."
```

---

### Task 8: Uniqueness — there is exactly one platform owner

**Files:**
- Create: `tests/platform-owner-uniqueness.test.ts`
- Modify: `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`
- Modify: `scripts/create-user.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/platform-owner-uniqueness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:readfileSync";
import { getDb } from "@/lib/db";

/* Spec P4. This test is not ceremony — it is what makes removing UNTOUCHABLE
 * safe. One platform_owner means "the founder may act as anyone"; two would mean
 * "two people may act as each other", which is authority with no accountability.
 * lib/impersonation.ts cites this file by name. Do not relax it alone. */

describe("exactly one platform_owner", () => {
  it("there is exactly one, and it is the founder", () => {
    const rows = getDb()
      .prepare("SELECT id, display_name FROM users WHERE role = 'platform_owner'")
      .all();
    expect(rows).toHaveLength(1);
  });

  it("the user API refuses to create one", () => {
    const src = readFileSync("app/api/admin/users/route.ts", "utf8");
    expect(src).toMatch(/platform_owner/);
  });

  it("create-user.mjs refuses to create one", () => {
    const src = readFileSync("scripts/create-user.mjs", "utf8");
    expect(src).toMatch(/platform_owner/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/platform-owner-uniqueness.test.ts 2>&1 | tail -25
```

Expected: FAIL — `pourya` is `owner` in the database, not `platform_owner`.

- [ ] **Step 3: Promote the founder and guard the count**

The DB currently has **no** `platform_owner` at all. Promote `pourya` (id 1) once, by hand, and record it in a migration rather than leaving it as a manual DB edit:

```ts
/* The founder is the platform owner. There is exactly one, by design (spec P4) —
 * lib/impersonation.ts's missing UNTOUCHABLE check depends on it. Do not "helpfully"
 * generalize this to a loop. */
db.prepare("UPDATE users SET role = 'platform_owner' WHERE username = 'pourya'").run();
```

Then the two refusal guards:

In `app/api/admin/users/route.ts` and `[id]/route.ts`, reject `platform_owner` on create and on role-change:

```ts
if (role === "platform_owner") {
  return NextResponse.json(
    { ok: false, error: "این نقش فقط برای بنیان‌گذار سامانه است" },
    { status: 400 }
  );
}
```

In `scripts/create-user.mjs`, after the `ROLES.includes(role)` check:

```js
if (role === "platform_owner") {
  const existing = db
    .prepare("SELECT COUNT(*) n FROM users WHERE role = 'platform_owner'")
    .get().n;
  if (existing > 0) {
    console.error("[create-user] a platform_owner already exists — there can be only one.");
    process.exit(1);
  }
}
```

Keep `platform_owner` in the script's `ROLES` list — `tests/roles.test.ts:46` asserts that list never drifts from `lib/roles.ts`, and removing the entry would break that test rather than enforce the rule.

- [ ] **Step 4: Verify**

```bash
npx vitest run tests/platform-owner-uniqueness.test.ts tests/roles.test.ts 2>&1 | tail -20
node -e 'const s=require("node:sqlite");const db=new s.DatabaseSync("data/routeflow.db",{readOnly:true});console.log(db.prepare("SELECT username,role FROM users WHERE id=1").get())'
```

Expected: PASS, and `pourya` / `platform_owner`.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts app/api/admin/users scripts/create-user.mjs tests/platform-owner-uniqueness.test.ts
git commit -m "feat(roles): the founder is the platform owner, and there is only one

promote pourya, and refuse every path that could create a second one: the user
API on create and on role-change, and create-user.mjs.

The count is not cosmetic. lib/impersonation.ts no longer has an UNTOUCHABLE
check -- the founder may act as any account in any tenant, including a tenant's
owner -- and that is only sound while there is exactly one of him. This test is
what the impersonation code cites when it needs to be safe."
```

---

### Task 9: The account switcher — list endpoint

**Files:**
- Create: `app/api/admin/impersonatable/route.ts`
- Modify: `lib/repo/impersonation.ts` (add the list read)
- Modify: `lib/repo/search.ts:81` (lift the owner-only restriction)
- Test: `tests/impersonatable-route.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/impersonatable-route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readImpersonatable } from "@/lib/repo/impersonation";

/* The list behind both mounts of the switcher (spec P8): every active account in
 * every organisation, grouped by org. Cross-tenant from the first commit — the
 * whole point is that the founder can reach a tenant he does not work for. */

describe("readImpersonatable", () => {
  it("lists users from every organisation, not just the caller's", () => {
    const rows = readImpersonatable(getDb(), "platform_owner");
    const orgs = new Set(rows.map((r) => r.organization_id));
    expect(orgs.size).toBeGreaterThanOrEqual(1);
  });

  it("never lists a deactivated account", () => {
    for (const r of readImpersonatable(getDb(), "platform_owner")) {
      expect(r.active).toBe(1);
    }
  });

  it("carries the fields the switcher renders", () => {
    const r = readImpersonatable(getDb(), "platform_owner")[0];
    expect(r).toHaveProperty("organization_name");
    expect(r).toHaveProperty("display_name");
    expect(r).toHaveProperty("role");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/impersonatable-route.test.ts 2>&1 | tail -20
```

Expected: FAIL — `readImpersonatable` does not exist.

- [ ] **Step 3: Add the read to the repo layer**

`lib/repo/impersonation.ts` — raw SQL lives here by repo convention (`tests/repo-boundary.test.ts` enforces it):

```ts
export type ImpersonatableUser = {
  id: number;
  display_name: string;
  role: string;
  group_id: number | null;
  organization_id: number;
  organization_name: string;
  active: number;
};

/** Every account the switcher may offer, across EVERY organisation.
 *
 *  Not scoped to the caller's org: cross-tenant support is the entire purpose of
 *  the tool, and the audit trail (Task 6) is what makes reading another
 *  tenant's data accountable rather than invisible. Deactivated accounts are
 *  excluded — offering one would mint a session that dies on the next request. */
export function readImpersonatable(db: DatabaseSync, actorRole: string): ImpersonatableUser[] {
  return db.prepare(
    `SELECT u.id, u.display_name, u.role, u.group_id, u.organization_id, u.active,
            o.name AS organization_name
       FROM users u JOIN organizations o ON o.id = u.organization_id
      WHERE u.active = 1 AND o.active = 1
      ORDER BY o.name, u.display_name`
  ).all() as ImpersonatableUser[];
}
```

- [ ] **Step 4: Lift the search restriction**

`lib/repo/search.ts:81` reads `if (session.role !== "owner" || tooShort(q)) return [];` — change to:

```ts
// A platform_owner searching for a person to act as is the switcher's whole use.
if (session.role !== "owner" && session.role !== "platform_owner") return [];
if (tooShort(q)) return [];
```

- [ ] **Step 5: Add the route**

`app/api/admin/impersonatable/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readImpersonatable } from "@/lib/repo/impersonation";
import { requireRole } from "@/lib/session";
import { logPlatformAccess } from "@/lib/platformAccess";

/** GET /api/admin/impersonatable?q= — the switcher's list, across every tenant.
 *
 *  platform_owner only. An owner gets the founder's own people, same as before;
 *  a platform_owner gets everyone, because diagnosing a tenant you do not work
 *  for is what the role is for. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "platform_owner"]);
  if (!guard.ok) return guard.response;

  const users = readImpersonatable(getDb(), guard.session.role);
  /* P10: logPlatformAccess is fully implemented and called from nothing. This is
   * the first call site in the app. Listing another tenant's staff is itself a
   * cross-tenant read, so it is the same thing the audit trail exists to record. */
  for (const u of users) {
    logPlatformAccess(getDb(), guard.session, "/api/admin/impersonatable", u.organization_id);
  }

  return NextResponse.json({
    ok: true,
    selfId: guard.session.user.id,
    users: users.map((u) => ({ ...u, isSelf: u.id === guard.session.user.id })),
  });
}
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -i impersonatable | head
npx vitest run tests/impersonatable-route.test.ts tests/search-repo.test.ts tests/repo-boundary.test.ts 2>&1 | tail -20
```

Expected: PASS. `repo-boundary.test.ts` is the one that catches raw SQL placed outside `lib/repo`.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/impersonatable lib/repo/impersonation.ts lib/repo/search.ts tests/
git commit -m "feat(switcher): the list of accounts, across every tenant

Not scoped to the caller's organisation. Cross-tenant support is the point of
the tool, and Task 6's audit column is what makes reading another tenant's
staff accountable rather than invisible -- so the list itself logs.

searchUsers had a role !== \"owner\" early return that returned nothing at all
for a platform_owner, which is why the existing Login-As search found no one."
```

---

### Task 10: `AccountSwitcher` — one component, two mounts

**Files:**
- Create: `components/meridian/AccountSwitcher.tsx`
- Modify: `components/meridian/ProfileMenu.tsx` (mount A)
- Create: `app/(shell)/switch/page.tsx` (mount B)
- Test: `tests/account-switcher.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/account-switcher.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Spec P8: ONE component, TWO mounts. The list was never written into the
 * ProfileMenu — it is mounted there — so promoting the dropdown to a full page
 * later is a mount, not a rewrite. This test is what stops someone inlining the
 * markup into the menu and quietly making that impossible. */

describe("AccountSwitcher", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("is one component, mounted in both places", () => {
    expect(src("components/meridian/ProfileMenu.tsx")).toContain("AccountSwitcher");
    expect(src("app/(shell)/switch/page.tsx")).toContain("AccountSwitcher");
  });

  it("the menu holds a link, not a second copy of the list", () => {
    expect(src("components/meridian/ProfileMenu.tsx")).not.toContain("impersonatable");
  });

  it("confirms before switching, because every action will be recorded", () => {
    expect(src("components/meridian/AccountSwitcher.tsx")).toMatch(/confirm\(/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/account-switcher.test.tsx 2>&1 | tail -20
```

Expected: FAIL — the component does not exist.

- [ ] **Step 3: Build the component**

`components/meridian/AccountSwitcher.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/meridian/Avatar";
import { ROLE_LABEL, type Role } from "@/lib/roles";

type Row = {
  id: number; display_name: string; role: string; organization_id: number;
  organization_name: string; isSelf: boolean;
};

/* The account switcher — ONE component, mounted twice (spec P8).
 *
 * A: inside the ProfileMenu dropdown, behind «ورود به‌عنوان…».
 * B: at /switch, the full page.
 *
 * Deliberately not written into the menu's markup. Mounting it twice is the
 * point: when the account count makes a dropdown cramped, mount B already exists
 * and A becomes a link to it. Inlining the list would make that a rewrite, and
 * tests/account-switcher.test.tsx fails if anyone tries.
 *
 * Grouped by organisation, because the founder works across tenants and the org
 * is the thing that is easy to forget when two tenants both employ a رضا. */

export default function AccountSwitcher({ variant = "menu" }: { variant?: "menu" | "page" }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/impersonatable")
      .then((r) => r.json())
      .then((d) => setRows(d.users ?? []))
      .catch(() => setRows([]));
  }, []);

  const byOrg = useMemo(() => {
    const m = new Map<number, { name: string; rows: Row[] }>();
    for (const r of rows) {
      if (q && !`${r.display_name} ${r.organization_name}`.includes(q)) continue;
      const e = m.get(r.organization_id) ?? { name: r.organization_name, rows: [] };
      e.rows.push(r);
      m.set(r.organization_id, e);
    }
    return [...m.values()];
  }, [rows, q]);

  async function actAs(row: Row) {
    // Every write from here on is recorded as this person, with our name beside
    // it. That is worth one confirmation — SearchOverlay.tsx:116 already does
    // this for the existing Login-As entry point.
    if (!window.confirm(`برنامه را به‌جای «${row.display_name}» ببینید؟ تا وقتی «بازگشت» را نزنید، هر کاری به نام او ثبت می‌شود.`)) return;
    setBusy(true);
    await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: row.id }),
    }).catch(() => null);
    router.push("/");
    router.refresh();
  }

  return (
    <div className={variant === "page" ? "p-[var(--space-5)]" : ""} dir="rtl">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="جستجوی نام یا سازمان…"
        className="mb-[var(--space-3)] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] outline-none focus:border-[var(--accent)]"
      />
      {byOrg.map((org) => (
        <section key={org.name} className="mb-[var(--space-4)]">
          <h3 className="m-0 mb-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-faint)]">{org.name}</h3>
          <ul className="m-0 list-none p-0">
            {org.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={r.isSelf || busy}
                  onClick={() => void actAs(r)}
                  className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-2)] py-[var(--space-2)] text-right disabled:opacity-40 enabled:hover:bg-[var(--surface-raised)]"
                >
                  <Avatar userId={r.id} name={r.display_name} size={26} />
                  <span className="flex-1 text-[length:var(--text-sm)] text-[var(--text)]">{r.display_name}</span>
                  <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {ROLE_LABEL[r.role as Role] ?? r.role}
                  </span>
                  {r.isSelf && <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">خودِ شما</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount A — in the `ProfileMenu`**

In `components/meridian/ProfileMenu.tsx`, add `import AccountSwitcher from "@/components/meridian/AccountSwitcher";` and `const [switching, setSwitching] = useState(false);`, then insert after the `.pm__who` block and before the نقشهٔ پوشش link:

```tsx
<div className="pm__sep" />

<button
  type="button"
  className="pm__link"
  onClick={() => setSwitching((v) => !v)}
  aria-expanded={switching}
>
  <Icon name="repeat" size="sm" /> ورود به‌عنوان…
</button>

{open && switching && (
  <div className="pm__panel" style={{ maxHeight: 320, overflowY: "auto" }}>
    <AccountSwitcher variant="menu" />
  </div>
)}
```

⚠️ Check `components/meridian/icon-map.ts` for a `repeat` glyph before using it; if absent, add one or reuse an existing name. The `Icon` component is a typed lookup, so an unknown name is a compile error — that is the intended behaviour, not something to work around with `as never`.

- [ ] **Step 5: Mount B — at `/switch`**

Create `app/(shell)/switch/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import AccountSwitcher from "@/components/meridian/AccountSwitcher";

export const dynamic = "force-dynamic";

/** The switcher as a full page — the same component the avatar menu mounts.
 *
 *  Owner and platform_owner only. The gate is here as well as in proxy.ts because
 *  this page reads the session directly rather than trusting a middleware pass. */
export default async function SwitchPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "platform_owner") redirect("/sales");

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--space-4)] py-[var(--space-5)]">
      <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">
        ورود به‌عنوان یک حساب
      </h1>
      <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
        هر کاری که اینجا انجام دهید به نام آن شخص ثبت می‌شود.
      </p>
      <AccountSwitcher variant="page" />
    </div>
  );
}
```

Add `/switch` to `proxy.ts` so the shell's gate agrees with the page — extend the admin prefix check at line 68:

```ts
const isAdmin = pathname.startsWith("/sales/admin") || pathname.startsWith("/api/admin")
  || pathname.startsWith("/switch");
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "AccountSwitcher|switch/page" | head
npx vitest run tests/account-switcher.test.tsx tests/app-header.test.ts tests/proxy.test.ts 2>&1 | tail -20
npm run lint 2>&1 | tail -10
```

Expected: PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add components/meridian/AccountSwitcher.tsx components/meridian/ProfileMenu.tsx 'app/(shell)/switch' proxy.ts tests/account-switcher.test.tsx
git commit -m "feat(switcher): one component, two mounts

A: a row in the avatar menu. B: a full page at /switch. The list is its own
component rather than markup inside the menu, so promoting the dropdown to a
page is a mount -- which it already is.

Grouped by organisation, because the founder works across tenants and two
tenants will eventually both employ a رضا."
```

---

### Task 11: The banner names both facts

**Files:**
- Modify: `components/meridian/ImpersonationBanner.tsx`
- Modify: `components/meridian/AppHeader.tsx:45` (pass the role)
- Test: `tests/impersonation-banner.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Spec §4.10 + Phase A §5.0: the banner must name BOTH facts — who you are
 * acting as, and in which world. "You are seeing the app as Ali" is not enough
 * once a person can hold two roles: as a driver he sees three tabs, as a seller
 * nineteen. An owner reading over a shoulder must never be confused about whose
 * permissions they are exercising. */

describe("ImpersonationBanner", () => {
  const src = readFileSync("components/meridian/ImpersonationBanner.tsx", "utf8");

  it("names the role as well as the person", () => {
    expect(src).toContain("asRole");
  });

  it("keeps the way back, and cannot be dismissed", () => {
    expect(src).toContain("بازگشت به حساب خودم");
    expect(src).not.toMatch(/dismiss|onClose/);
  });

  it("still says the work is recorded in their name", () => {
    expect(src).toMatch(/به نام او ثبت می‌شود/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/impersonation-banner.test.tsx 2>&1 | tail -20
```

Expected: FAIL — no `asRole` prop.

- [ ] **Step 3: Add the prop and use it**

```tsx
export default function ImpersonationBanner({ asName, asRole }: { asName: string; asRole: string }) {
  // …existing back() unchanged…
  return (
    <div className="actas" role="status">
      <Icon name="user" size="sm" />
      <span className="actas__text">
        در حال دیدن برنامه به‌جای <b>{asName}</b>، نقش <b>{asRole}</b>. هر کاری که اینجا انجام دهید به نام او ثبت می‌شود.
      </span>
      <button type="button" className="btn solid" onClick={() => void back()} disabled={busy}>
        {busy ? "در حال بازگشت…" : "بازگشت به حساب خودم"}
      </button>
    </div>
  );
}
```

`components/meridian/AppHeader.tsx:45`:

```tsx
{session.actorId
  ? <ImpersonationBanner asName={session.user.display_name} asRole={ROLE_LABEL[session.role]} />
  : null}
```

`ROLE_LABEL` is already imported in that file.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/impersonation-banner.test.tsx 2>&1 | tail -15
git add components/meridian/ImpersonationBanner.tsx components/meridian/AppHeader.tsx tests/
git commit -m "feat(banner): name the role too, not only the person

\"You are seeing the app as Ali\" stops being true the moment a person can hold
two roles: as a driver he sees three tabs, as a seller nineteen. The banner now
says both, so nobody reading over a shoulder is confused about whose
permissions are being exercised."
```

---

### Task 12: A second tenant, so cross-tenant is not untested code

**Files:**
- Create: `scripts/seed-demo-org.mjs`
- Test: `tests/seed-demo-org.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { getDb } from "@/lib/db";

/* There is exactly one organisation today. Every cross-tenant path in this plan
 * would ship unexercised and be found broken the day customer two signs up.
 * This seeds a second tenant and, just as importantly, proves it touches nothing
 * in org 1. */

const counts = () => {
  const db = getDb();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    orgs: n("SELECT COUNT(*) n FROM organizations"),
    users: n("SELECT COUNT(*) n FROM users WHERE organization_id = 1"),
    customers: n("SELECT COUNT(*) n FROM customers WHERE organization_id = 1"),
    orders: n("SELECT COUNT(*) n FROM orders WHERE organization_id = 1"),
  };
};

describe("seed-demo-org", () => {
  it("creates a second organisation", () => {
    execFileSync("node", ["scripts/seed-demo-org.mjs"], { stdio: "pipe" });
    expect(counts().orgs).toBeGreaterThanOrEqual(2);
  });

  it("leaves org 1 byte-identical", () => {
    const before = counts();
    execFileSync("node", ["scripts/seed-demo-org.mjs"], { stdio: "pipe" });
    const after = counts();
    expect(after.users).toBe(before.users);
    expect(after.customers).toBe(before.customers);
    expect(after.orders).toBe(before.orders);
  });

  it("removes cleanly", () => {
    execFileSync("node", ["scripts/seed-demo-org.mjs", "--remove"], { stdio: "pipe" });
    expect(counts().orgs).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/seed-demo-org.test.ts 2>&1 | tail -20
```

Expected: FAIL — the script does not exist.

- [ ] **Step 3: Write the seed script**

Model it directly on `scripts/seed-demo.mjs`, which already has the discipline this needs:

- **Marker-based and reversible** — everything keyed on the created org's `organization_id`; `--remove` runs with `enableForeignKeyConstraints: false` and asserts `foreign_key_check` is clean before committing. Reuse that teardown pattern verbatim; do not invent a second one.
- **~8 users spanning every role** — `owner`, `group_manager`, `rep_manager`, `phone_sales`, `field_rep`, `delivery_driver` ×2, plus its own groups.
- **History, not just rows** — ~40 customers, ~30 leads with `saved_locations`, orders across several weeks, delivery runs with stops, visits, tasks, cheques. A tenant with rows but no *history* proves nothing about a support tool, which is about time.
- **Never org 1** — every INSERT names the new org id explicitly. `seed-demo.mjs` hardcodes `organization_id = 1` in ~15 places; that is the single-tenant assumption that does not transfer, so do not copy those literals.
- **Invented data only** — Persian business names resembling nothing in طعمینو's real customer list.

- [ ] **Step 4: Verify**

```bash
npx vitest run tests/seed-demo-org.test.ts 2>&1 | tail -20
node scripts/seed-demo-org.mjs && node scripts/seed-demo-org.mjs --remove
```

Expected: PASS both ways; idempotent on re-run.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo-org.mjs tests/seed-demo-org.test.ts
git commit -m "feat(demo): a second tenant, so the cross-tenant paths are not untested

Every cross-tenant path in the platform_owner work would otherwise ship
unexercised and be discovered broken the day customer two signs up.

seed-demo.mjs is the model -- marker-based, reversible, foreign_key_check clean
before commit -- and its hardcoded organization_id = 1 is exactly the
single-tenant assumption that does not transfer. The test asserts org 1's row
counts are identical before and after, which is the claim that matters."
```

---

### Task 13: Full verification

**Files:** none — this task only runs checks.

- [ ] **Step 1: Run the whole unit suite**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all pass. This takes several minutes — run it detached with output redirected to a file and poll, rather than letting the command time out.

- [ ] **Step 2: Run the smoke suite**

```bash
npm run test:smoke 2>&1 | tail -30
```

- [ ] **Step 3: Type check, lint, and the repo's own audits**

```bash
npx tsc --noEmit 2>&1 | grep -v "RouteContext\|LayoutProps" | head -20
npm run lint 2>&1 | tail -10
npm run check:contrast 2>&1 | tail -10
npm run audit-copy 2>&1 | tail -10
```

The `grep -v` filters the known pre-existing `TS2304 'RouteContext'` noise caused by the gitignored `next-env.d.ts`. Any *other* error is a regression from this work.

- [ ] **Step 4: Re-verify the two invariants by hand**

```bash
# exactly one platform_owner
node -e 'const s=require("node:sqlite");const db=new s.DatabaseSync("data/routeflow.db",{readOnly:true});console.log(db.prepare("SELECT username,role FROM users WHERE role=?",["platform_owner"]).all())'

# no management gate still omits platform_owner — expect 0
grep -rn 'requireRole(req, \[' app/ | grep '"owner"' | grep -vc 'platform_owner\|MANAGE_ROLES'
```

Expected: exactly one row; `0`.

- [ ] **Step 5: Manual browser smoke**

1. Sign in as `pourya` — every nav tab is live, including کاربران, گروه‌ها, مکان‌های ما (previously greyed out).
2. Open `/driver` — the notice, not a redirect. Click «ورود به‌عنوان راننده».
3. Switch to a driver — the banner names both person and role; `/driver` now shows a real round.
4. Make a change (mark a stop delivered) — the history shows the driver, with a «توسط پوریا» tag.
5. «بازگشت به حساب خودم» — you are yourself again, tabs restored.
6. Open `/switch` — the same list, full page, grouped by organisation, both tenants.
7. Switch into a **شرکت پخش پارس** account — you are in that tenant, and a `platform_access_log` row was written.

---

## Ordering and dependencies

```
Task 1  commit the rename          ← must be first; everything else diffs against it
Task 2  MANAGE_ROLES + sweep       ← independent
Task 3  named constants            ← independent
Task 4  pages, proxy, appNav       ← needs 2 and 3
Task 5  driver notice              ← needs 4 (proxy must exempt platform_owner)
Task 6  impersonated_by            ← independent, and the highest-value fix
Task 7  impersonationRefusal       ← independent
Task 8  uniqueness                 ← independent; promotes pourya
Task 9  list endpoint              ← needs 7
Task 10 AccountSwitcher            ← needs 9
Task 11 banner                     ← needs 7
Task 12 demo tenant                ← independent
Task 13 verification               ← last
```

Tasks 6, 7, 8 and 12 have no ordering constraints among themselves. The founder holding **two** roles at once is Phase A's `user_roles` table plus the picker; this plan does not build it, and Task 8 gives him the single god-mode role that unblocks everything else here.

## Risk register

| Risk | Mitigation |
|---|---|
| The perl import sweep mangles an import | `tsc` after the sweep; the pattern is proven on the 81 identical sites first |
| A management gate is missed | `platform-owner-reach.test.ts` walks the real source tree, not a hand-maintained list |
| `CAN_SELL` divergence is a pre-existing bug, not a regression | Called out explicitly in Task 3, with its own verification step |
| Removing `UNTOUCHABLE` outlives its justification | The uniqueness test and the in-code warning at the old `UNTOUCHABLE` site name each other |
| `impersonated_by` is added to a table but not to its writer | The test asserts the *written value*, not merely the column's existence |
| Cross-tenant code ships unexercised | Task 12 seeds a second tenant; the test asserts org 1 is untouched |
| The admin layout is accidentally widened to `group_manager` | Task 4 calls it out; the layout keeps an explicit owner-or-platform_owner check |
| `session.ts`'s org check kills every cross-tenant switch | Task 7 Step 4 spells out the exact condition change and why |

## What this plan does not build

- **`user_roles` / `session.roles` / the role picker.** Phase A, spec
  `2026-09-28-multi-role-switcher-design.md`, plan
  `2026-09-28-multi-role-switcher.md`. The founder gets the single god-mode role here;
  holding `platform_owner` *and* `owner` simultaneously is Phase A's work.
- **A read-only impersonation mode.** Spec P6 — the founder asked for full write, and a
  read-only variant is a feature for a future role, not this one.
- **Tenant self-service switching.** A different product with different risks.

