@AGENTS.md

# Batch rule: do all the tasks, then merge once at the end

Finish the whole list of tasks first, then merge. CI is slow, so do not stop and wait on it between tasks.

- One commit per task, with its own message, on the designated branch. Push as you go.
- Keep a single open pull request for the branch and update its description as commits are added. Do not merge, and do not wait for CI, between tasks.
- Open the batch pull request as a **draft**: CI does not run on drafts (it is billed per minute). When every task is done, mark it ready for review; that starts CI on the final head. Open a PR as ready only when it is a single-commit change.
- When every task is done, mark the PR ready, wait for CI on the final head, then merge the pull request once, with a merge commit so each task's commit stays visible in history.
- Only merge when the PR has no conflicts and CI is not failing; otherwise fix that first, then merge. If `main` moved, merge it into the branch and resolve conflicts before the final merge.
- If the branch has no open PR when the tasks are finished, open one (merging was asked for); if the task list was only a question, do not create one.
- This replaces the earlier rule of merging after every commit and push.

# GitHub labels, milestones and the board

Follow `docs/github-workflow.md`. An issue is opened when work on a roadmap batch starts or a bug is found, never copied ahead from the roadmap. Every issue gets one `type:`, one or more `area:` and one `priority:` label, and the batch's milestone; every pull request gets its `type:` and `area:` labels, the same milestone, and `Closes #n` for each issue it finishes. A question for the owner also gets `status: needs decision`. Labels change only through `scripts/github-labels.sh`, updated in the same commit as that doc.

# Always-on: look for existing solutions before building

Before adding any new functionality (a feature, helper, integration, UI primitive, parser, algorithm or script), search for something that already exists. Do not start writing it first.

1. **Search.** Use the web (WebSearch, WebFetch), the npm registry (`npm view <package> version time.modified`) and this repo (it may already have it). Look for open-source libraries, plugins, example code and self-hostable services.
2. **Analyze** each serious candidate on: what it covers of the need, licence, last release and maintenance, size, security record, fit with this stack (Next.js 16, TypeScript, PostgreSQL), Persian and right-to-left support, and the project's constraints: the server is in Iran, so no paid foreign API or key, and it must be self-hostable and installable from there.
3. **Ask the user to decide.** Give a short comparison and your recommendation: use library A, use B, or build from scratch (say what building costs and what it buys). Use AskUserQuestion. Do not add a dependency or start building until they answer.
4. **Record** the decision in the relevant doc (`docs/decisions.md` section 10 or the feature's entry) and in `TODO-REPORT.md`.

When a batch of tasks is given (see the batch rule), do the search for all of them first and ask all the questions in one round, so the work is not interrupted between tasks.

Skip the search for: bug fixes, edits inside existing code, a few lines of glue, and anything the user has already told you to build or to use a named library for.

# Always-on: the smallest complete change

Adapted from the ponytail ruleset (github.com/DietrichGebert/ponytail, MIT). It sits beside the rules above and never overrides them: a new dependency or a new feature is still decided by the owner (see "look for existing solutions"), and the to-do report is never skipped.

1. **Scope first.** Before editing, list every place the change must reach: callers, tests, fixtures, seed data, config, exports, docs. Check what it could break for users (data it would destroy or expose, callers that stop working). Finish all of that. Extra features are not scope.
2. **Take the first option that fully works:** does it need to exist at all (a vague ask gets the smallest version that does the core job, and the skipped extras are named in one line); a helper, component or pattern already in this repo, used the way the surrounding code uses it; the platform or Node standard library; a dependency that is already installed; one line a reader gets at a glance; otherwise the minimum code. Never add a dependency for a few lines.
3. **No unasked-for code.** No abstraction, wrapper, option, config flag, type conversion or "for later" hook that nobody asked for. Keep the structure the codebase already has. Deleting beats adding. Moved or merged code keeps its validation and error handling.
4. **Bug fixes:** grep every caller of the function you touch, then fix the root cause once in the shared code, not at each call site.
5. **Check the new logic.** A new branch, loop, parser, money or security rule, or a new script leaves one small test (Vitest, next to the existing ones). Trivial edits need none.
6. **Mark a known shortcut** with a one-line comment: `shortcut: <the limit>, <when to upgrade>`. Comment only the why that the code cannot show.
7. **Never cut:** validation at trust boundaries, error handling that prevents data loss, auth and company scoping, accessibility and right-to-left, tombstones and offline sync rules, anything the owner asked for.
8. **End each reply with one or two lines:** what was skipped or not checked, and any risk the owner must know.

# Always-on: to-do report after every prompt

At the end of every reply, update `TODO-REPORT.md` at the repo root and show the same content concisely in the reply. Three lists, in this order:

- **Done** — checked items, one line each.
- **Not done / gaps** — unchecked items and known limits.
- **Next steps** — numbered, in the order they will be worked.

Keep it current: move items from Next steps to Done as they finish, add new gaps as they are found. Commit `TODO-REPORT.md` together with the work it describes.

# UI work follows the mobile-first rules

UI work follows `docs/mobile-first-principles.md` (and `docs/tap-flow-principles.md` for flows that record what just happened). Run `npm run check:mobile` before committing UI changes; it fails on a new `<select>`, native date, small tap target or confirm dialog, on a mobile component with no test, and on an allowlist entry without a written reason.

# Always-on: a UI feature is not done until a person can reach it and it looks right

Applies to any change that adds or moves something a user sees. Bug fixes inside an existing screen skip step 1.

1. **Place it before you build it.** Before writing UI code, write down which roles use it, which nav group it belongs to (`APP_GROUPS` in `lib/appNav.ts`), which screen, where on that screen (top card, list row action, bottom bar, sheet), and how many taps it is from the bottom bar. Check it against the budgets in `docs/mobile-first-principles.md` section 5 (any destination ≤ 2 taps). Put this placement note in the PR description under «محل در رابط کاربری». If no good spot exists within budget, ask the user rather than burying it.
2. **Every page is reachable.** A new page is a nav tab in `lib/appNav.ts`, is linked from a screen that renders, or has a written reason in `tests/every-page-reachable.test.ts`. That test fails otherwise.
3. **No button leads to a refusal.** Show a link or button only to the roles whose gate (`proxy.ts`, the page's own redirect, the API's `requireRole`) lets them through. Use the shared role sets rather than repeating them: `appTabs(...).ready` for pages, `canSell` for orders, `accountLinks` for the account menu. A role that reaches a form it cannot save sees why, not a failed save.
4. **Tapping a name opens it.** Wherever a customer, supplier, account or order is named, the name links to its page (`components/CustomerName.tsx` for customers), except where the whole card is already the tap target.
5. **Use what exists.** Pages start from the shared shell (title, primary action in the thumb zone, loading, empty and error states). Overlays are `BottomSheet`, bottom bars `StickyAction`, filters `FilterChips`, days `DayChips`. Do not hand-roll a modal, a dropdown or a fixed bar. If nothing fits, say why in the PR.
6. **Look at your own screen before saying done.** Run the app against a throwaway database (`scripts/preview.sh`, never `data/routeflow.db`), open the changed page in Chromium at 390×844, right to left, as a role that uses it, in light and dark. Take a screenshot and look at it. At minimum check: no sideways scroll, no clipped Persian text, nothing hidden behind the bottom bar, tap targets ≥ 44 px, and the empty state reads well. Fix what you see.
7. **End-of-batch tour.** The batch PR description ends with a «تور رابط کاربری» section listing each changed screen, where it lives and which roles see it, with a phone-width screenshot when one can be attached.
8. **No redirects for old addresses yet.** The app has no users, so a renamed or removed page is simply renamed or removed: no redirect stub, no `next.config` redirect. Revisit this once real users exist.
