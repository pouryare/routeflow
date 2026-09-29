# Always-On Task List — Design

**Date:** 2026-09-29
**Status:** Approved (user: "write the spec then start implementing it")
**Scope:** One always-on rule file + one gitignored data file. No application code, no tests, no UI.

---

## Problem

Work in this repo is long and multi-step, and it is routinely relayed across `/newtask`
subtasks (`/long-haul-development.md`). Two consequences:

1. **Progress is invisible.** You cannot see what is done, in flight, or left without
   reading prose or diffing the tree.
2. **Context is volatile.** Each `/newtask` subtask starts empty, and compaction wipes
   the window. Any progress that lives only in the conversation dies at that seam.

A chat-only list does not fix (2). This design puts the list on disk so it survives both.

## Deliverables

- **`.clinerules/todo.md`** — the always-on rule. Auto-loads with `report.md` and
  `superpowers.md`. No slash command, no workflow file.
- **`.cline/todo.md`** — the data file: rolling current-task list + append-only Done
  archive. Gitignored (`.gitignore:75`), so the archive is local scratch, never a diff.

**Explicitly NOT built:** no `.clinerules/workflows/*.md` file (user: "just a rule is
enough"), no todo tool integration (none exists in this session — the toolset is
`read_files`, `search_codebase`, `run_commands`, `editor`, `fetch_web_content`,
`ask_question`), no code changes.

---

## Assumptions (user did not redirect; stated explicitly)

| Decision | Choice | Why |
|----------|--------|-----|
| Rule placement | New file `.clinerules/todo.md` | One concern per file; reviewable on its own. Appending to `report.md` was the alternative. |
| List position in chat | **Bottom** of the response | The answer comes first; status follows. Never delays what was asked. |
| Rule vs. workflow | Rule only | User: "just a rule is enough". |
| Storage | File-backed, not chat-only | User changed their mind mid-design to "use files on disk". |
| Archive | Appended at bottom of same file | "so you can scroll back without file sprawl" |

---

## Design

### 1. The rendered list

Emoji glyphs, always visible, at the bottom of every response:

```
⬜ Read the existing role-gate code
🔄 Write the failing test
✅ Grep every call site
⬜ Run tsc --noEmit
⬜ Report

3/5
```

**One-item lists collapse to a single line**, so trivial work stays cheap:

```
🔄 Fix the guard — 1/1
```

This is the escape hatch that makes "always show" affordable.

### 2. Update contract

The part that matters — a stale list is worse than no list.

- **One item = one verifiable outcome**, phrased as something *done*, not a topic.
  "Add tests" is a topic. "The money path has a failing test" is an outcome.
- **Exactly one 🔄 at a time.** Two in progress means the list is lying.
- **The file is the source of truth; the chat render is a copy.** Update the file
  *before* reporting. If they disagree, the file wins.
- **✅ means verified, not written.** Per `report.md`, verification means
  `npx tsc --noEmit` clean or a targeted `npx vitest run tests/<file>` passing.
  **Never** `next build`, `next start`, or the Playwright smoke suite.
- **Two known flakes are not failures.** `tests/jalali.test.ts` and
  `tests/api/routing-route.test.ts` time out under full-suite CPU contention and pass
  in isolation. A ✅ requires the isolated run.
- **Append to Done on task end**, with the date and the verification command actually
  run. Trim the oldest archive entry past ~200 lines.

### 3. Fresh context

On a blank context (new subtask, post-compaction): **read `.cline/todo.md` first, resume
from it, and never narrate the rebuild.** The file is how a subtask learns what was 🔄
when the context was cut.

### 4. Boundaries — other rules still win

- `report.md` governs the three-part report and ELI5 depth. The list is a status
  footer, not a substitute.
- `caveman.md` compresses surrounding prose; the list stays legible as state.
- `ponytail.md`'s laziness never means skipping a list update.
- `/brainstorming.md` still gates creative work; `/writing-plans.md` still writes the
  plan. This rule **tracks** work, it never authorises skipping a step.
- The list is never the verification. `report.md`'s command-level proof still is.
- The full suite takes ~14 min: launch detached (`setsid nohup … &`) and poll. Never
  assume a foreground "timeout" is a failure.

---

## Files

| Path | Tracked | Role |
|------|---------|------|
| `.clinerules/todo.md` | yes | The rule. Versioned, reviewed like code. |
| `.cline/todo.md` | no (`.gitignore:75`) | The list. Disposable scratch. |

That separation is the whole trick: the rule is durable, the data is not, so an
unbounded archive costs nothing.

## Risks

- **Staleness** if the file is updated after the report rather than before. Mitigated
  by making file-update a precondition of the report, not a follow-up.
- **Ceremony creep** — a list that grows sub-items for a one-line fix. Mitigated by the
  one-item collapse and by the outcome-not-topic rule.
- **Rule bloat in context** — every always-on rule is loaded every task. Kept short and
  imperative; no worked examples beyond the two renders above.

## Verification

Rules are prose, so there is no test to run. Verification is behavioural:

1. Start a multi-step task — a list appears and `.cline/todo.md` is created.
2. Complete one item — the glyph flips to ✅ **and the file changes before the report**.
3. Ask a trivial question — a single line, not a block.
4. `/newtask` into a subtask — the list resumes from the file with no narration.
5. `git status` — `.cline/todo.md` absent (ignored), `.clinerules/todo.md` present.
