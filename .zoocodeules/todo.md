---
name: todo
description: Always-on task list rule. Maintains a verifiable task list in .cline/todo.md and renders it at the bottom of every response. Loaded into every task automatically.
---

# Task List (always-on)

Keep a task list for the work in flight, and show it. Every response ends with the
current state. The list is a status footer, not a report and not a preamble.

## The two files

| Path | What it is |
|------|-----------|
| `.cline/todo.md` | The **data** — the list itself, plus a Done archive. Disposable scratch. |
| this file | The **rule**. You are reading it now. |

`.cline/` is gitignored, so the list never shows up in a diff or a commit. Write it
freely; do not try to preserve it in git.

## The list is on disk. Always.

**`.cline/todo.md` is the source of truth. The chat render is a copy of it, never the
original.**

Order of operations, every time, no exceptions:

1. **Update `.cline/todo.md` FIRST.**
2. Then report.
3. The chat block is rendered from the file you just wrote.

A list reported in chat but not written to the file does not exist. If the two ever
disagree, the file wins and the chat is wrong.

## On a fresh context

Empty window, a `/newtask` subtask, or anything after compaction: **read
`.cline/todo.md` before doing anything else**, and resume from it — including the item
that was `🔄` when the context was cut.

Do not narrate the rebuild. No "I see we were working on X", no apology for the missing
list. Just resume, as if you never lost it — because the file did not.

## When to have a list at all

**Always.** There is no "too small for a list" judgement call to make. Trivial work is
handled by the collapse rule below, not by skipping.

If the user asked a pure question with no work attached ("what does this do?", "is X
true?"), answer it and do not invent a task. A list tracks work; a question is not work.

## Rendering

At the **bottom** of the response, after the answer. Never before it, never in the
middle of prose.

```
⬜ Read the existing role-gate code
🔄 Write the failing test
✅ Grep every call site
⬜ Run tsc --noEmit
⬜ Report

3/5
```

- `⬜` not started
- `🔄` in progress
- `✅` done **and verified**
- One line per item, no nesting, no sub-bullets.
- Counter last: `done/total`.

**One item collapses to a single line.** This is what makes "always" affordable:

```
🔄 Fix the guard — 1/1
```

Never expand a one-item list into a five-line block. Never pad a trivial task with
ceremony.

## Writing items

**One item = one verifiable outcome.** Phrase it as something that gets *done*, not a
topic you work through.

- ✅ "The money path has a failing test" — outcome
- ❌ "Add tests" — topic
- ✅ "`tsc --noEmit` reports zero errors" — outcome
- ❌ "Type checking" — topic

If you cannot tell whether an item is finished, it is badly written. Rewrite it.

**Exactly one `🔄` at a time.** Two in progress means one is a wish, not a task. Promote
the real one, demote the other to `⬜`. If work genuinely forks into parallel tracks,
the list lies by omission — keep one active.

**Re-slice freely.** The list is allowed to change shape as the work is understood. A
newly discovered sub-task gets added. An item that turned out to be two items gets
split. Editing the list is not a concession — a list that was right at the start and
wrong at the end was never useful.

## ✅ means verified, not written

Do not tick an item because the code is written. Tick it when you have **run the
command and read the result**.

The only verification that counts on this machine:

| Purpose | Command |
|---------|---------|
| Type safety | `npx tsc --noEmit` — zero errors is a pass |
| Tests | `npx vitest run` — background it, poll the log |
| Quick subset | `npx vitest run tests/<file>.test.ts` |

**Never run** `next build`, `npm run build`, `next start`, or the Playwright smoke
suite. This machine cannot finish a production build.

**The full suite takes ~14 minutes.** Launch it detached and poll:

```
setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &
```

A foreground command that "timed out" has almost certainly **kept running**. Never
report it as a failure without checking the log first.

### The three flakes that are not failures

Under full-suite load these exceed vitest's 5s default and fail with
`Test timed out in 5000ms`. Timings are **idle-machine** figures, measured 2026-10-01:

- `tests/district-coverage.test.ts` — "has no interior hole in the net" — **3222ms (64%)**
  ⚠️ the closest to the line; it fails ~1 run in 3 even idle. Treat as the least reliable.
- `tests/api/routing-route.test.ts` — "plans, commits and freezes" — **3704ms (74%)**
- `tests/routing-repo.test.ts` — "builds a greedy plan ordered nearest-first from the depot"
  — **1907ms (38%)**

All three do **real work** (a 9,576-cell point-in-polygon sweep; a full routing plan), so
their cost is intrinsic, not wasted setup. A run reporting 1–2 failed / rest passed with
those names **is a pass**.

**`tests/jalali.test.ts` was removed from this list on 2026-10-01 — it was never a flake.**
It failed alone ~50% of the time (5412ms / 5644ms vs a 5000ms budget) because its oracle
built a new `Intl.DateTimeFormat` per call across 7,672 days: ~21 seconds constructing
identical objects to do 0.3 seconds of formatting. Fixed by hoisting it — now 489ms. The
same pattern was then found and fixed in `lib/jalali.ts` (10x) and `lib/orderJourney.ts`
(67x).

Before recording any failure: `npx vitest run tests/<file>`. Only a failure that
reproduces alone is real — and **run it more than once**, because a borderline test gives a
coin flip. Do **not** raise the global timeout to hide slowness; if a test is borderline
*on its own*, it is too slow and the timeout is hiding a defect.

## The Done archive

When a task ends, append to the bottom of `.cline/todo.md`:

```
## Done

- 2026-09-29 — Role-gate audit — verified: npx tsc --noEmit (0 errors)
```

Record the command you actually ran, not the one you meant to run. Trim the oldest
entry when the file passes ~200 lines. The archive is a convenience for scrolling back;
it is not history worth preserving.

## Boundaries — other rules still win

- **`report.md`** still governs the three-part report and the ELI5 depth. The list is a
  footer under it, never a replacement. The list is **not** the verification.
- **`/brainstorming.md`** still gates creative work. A design is still approved before
  code, even on a one-item task.
- **`/writing-plans.md`** still writes the plan. `/long-haul-development.md` still
  writes `.cline/plan.md` + `.cline/journal.md`. This rule tracks that work; it does
  not replace it.
- **`/test-driven-development.md`** still applies. An item can be `✅` only after the
  test was actually seen to fail first.
- **`caveman.md`** compresses the surrounding prose. It does not compress the list into
  something unreadable — the list is state, and state stays legible.
- **`ponytail.md`**'s laziness is about code, never about skipping a list update.

**The list never authorises skipping a step.** It shows where you are. It does not
decide what "done" is allowed to mean.

## What this rule is not

- Not a progress bar you set once and forget. A list that does not change as the work
  changes is decoration.
- Not a plan. `/writing-plans.md` writes plans; this only tracks execution.
- Not a report. `report.md` reports.
- Not a substitute for thinking. Writing a beautiful list of the wrong five things is
  still the wrong five things.
