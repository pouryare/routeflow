---
name: long-haul-development
description: Use when the work is too large to finish within one context window - big codebase, multi-step refactor or feature, or a small-context model that fills up fast. Externalizes the plan and progress to disk and relays across fresh Cline tasks (/newtask) so quality holds across the whole job, with no subagents required.
---

# Long-Haul Development

> **Announce at start:** "Using long-haul-development — disk-backed plan + journal, relaying across tasks to stay under the context budget."

Use it when the job is bigger than your context window — a large refactor across many files, a feature that touches a sprawling codebase, or any model with a small window (e.g. 200k, where you should stop well before the wall). The controller-with-workers pattern needs subagents you don't have; this workflow gets the same result a different way.

## The core idea

**Context is a scratchpad. Disk is memory.** If you try to hold the plan, the codebase, and the running progress all in context, you hit the wall mid-task and either degrade or lose state. Instead: do one bounded chunk of work, write down everything the *next* session needs, and hand it a clean slate. Repeat until done. The plan and the journal on disk are the project's real memory — the conversation is disposable.

## State files (these ARE the memory)

- **`.cline/plan.md`** — the task list, as a checkbox list. The source of truth for *what* to do and *in what order*. Created once; tasks get checked off as they complete.
- **`.cline/journal.md`** — an append-only running log. After every task you append: what you did, decisions made, the handful of files that matter (path + one-line why), gotchas you hit, and what the next task must know. This is what a fresh task reads to get oriented *without re-reading the codebase*.

Both are plain markdown. `.cline/` should be git-ignored — add it to `.gitignore` first if it isn't already (this repo's `.gitignore` already includes it).

Cline may auto-condense the conversation as it fills — treat that as a bonus, not your safety net. The journal is your safety net.

## Step 0 — Starting, resuming, or stale state?

First, check whether `.cline/plan.md` exists.

**No `.cline/plan.md`** → you're **starting** (jump to "Starting" below).

**`.cline/plan.md` exists** → read the goal line at the top of `.cline/plan.md` (and `.cline/journal.md` if needed). Does it match the work you've just been asked to do?
- **Matches** → you're **resuming.** Read `.cline/plan.md` and `.cline/journal.md` *first, before anything else*. Find the first unchecked task — that's your task. **Do not re-read the whole codebase**; the journal tells you which files matter. Go to "The per-task loop".
- **Doesn't match (or you can't tell)** → this is probably leftover state from a previous job. **Do not silently overwrite it and do not silently resume the wrong job.** Ask the user:
  > "There's existing `.cline/` state for: *<old goal from plan.md>* — `<N>` of `<M>` tasks done. Resume that, or start a new job? If new, I'll move the old files to `.cline/archive/<timestamp>/` so they're not lost."
  Wait for the answer. If they say resume → treat as Resuming above. If they say new job → `mkdir -p .cline/archive/<timestamp>/`, move the existing `.cline/plan.md` and `.cline/journal.md` (and any other loose files in `.cline/`) into it, then proceed to "Starting". Only archive after they've confirmed.

**Starting** (clean `.cline/`, no plan):
1. If you don't already have an implementation plan, run `/writing-plans.md` to produce one. Tasks must be small — see "Sizing tasks" below.
2. Save the plan to `.cline/plan.md` as a checkbox list, with the goal on the first line (e.g. `# Plan: <goal>`) so a future session can tell what this state belongs to.
3. Create `.cline/journal.md` with: the goal (1–2 sentences), the starting state, and any context the work depends on.
4. Begin Task 1.

## The per-task loop

For each task:

1. **Orient cheaply.** Read the task text from `.cline/plan.md` and the relevant entries in `.cline/journal.md`. Read only the files they flag as relevant — and only the parts you need (grep/`search_files` to the symbol, note the line numbers, read that range). Never slurp a whole large file for a small part of it.
2. **Do the task.** If it's code, follow `/test-driven-development.md`. Make the change; run the verification the plan specifies.
3. **Self-review.** Does it match the spec? Anything broken or half-done? Fix it before moving on. Run `/verification-before-completion.md` — don't claim a task is done without checking. (If a task warrants a true outside review, relay a *review-only* task via `/newtask` rather than skipping it.)
4. **Record (do not skip this).** Check the task off in `.cline/plan.md`. Append to `.cline/journal.md`:
   - what you did, in 1–3 lines
   - any decision the next session would otherwise have to re-derive
   - files touched / discovered, each with a one-line "why this matters"
   - any gotcha, surprise, or constraint you found
   - what the next task needs to know to start fast
5. **Budget check — every task, before starting the next:**
   - Check Cline's context usage. If continuing one more task + writing its journal entry + relaying would risk crossing your hard limit (for a 200k window, that's ≈150k — so stop *starting new tasks* around ~60% / ≈120k to keep headroom), **do not start another task.**
   - Instead: make sure `.cline/plan.md` and `.cline/journal.md` are fully current, then **relay** — invoke `/newtask` with the handoff prompt below — and end this task.
   - If you're comfortably under the threshold: continue to the next task in the loop.

When the last task is checked off: run a final `/verification-before-completion.md` over the whole change, note "COMPLETE" at the top of `.cline/journal.md`, and hand off to `/finishing-a-development-branch.md`.

## The handoff prompt (what you pass to `/newtask`)

Keep it tiny. The new task reads the files for everything else.

```
Continuing long-haul work — run /long-haul-development.md.
- Plan:    .cline/plan.md   (resume at the first unchecked task)
- Journal: .cline/journal.md (read this FIRST — it has the relevant files and current state)
- Goal:    <one sentence>
Do not re-read the whole codebase. The journal tells you what matters.
```

Do **not** dump the conversation history into the handoff. If it's worth carrying, it's already in the journal — and if it isn't in the journal, put it there before you relay.

## Reading discipline (non-negotiable on a small context)

- Never `read_file` a large file to get a small piece. `search_files`/grep to the symbol or string, note line numbers, read the range.
- Don't re-read files you already understand. The journal entry IS your note that you understood them.
- Don't read directories "just to orient." Orient from `.cline/plan.md` and `.cline/journal.md`.
- If you need a file the journal didn't mention: read it surgically, *and* add a journal note so the next task doesn't rediscover it from scratch.

## Sizing tasks

A task you can't comfortably finish in well under half the context budget — including reading what you need and writing the journal entry — is too big. Split it in `.cline/plan.md` before starting. Each task should have: a clear scope, ~1–3 files, and a definite verification. If `/writing-plans.md` produced coarse tasks, refine them into smaller ones first.

## Red Flags

You're about to blow the budget or lose state when you think:

| Thought | Reality |
|---|---|
| "I'll squeeze in this last task before relaying." | If you're past the threshold you might not finish it cleanly. Relay now — the journal makes the next task fast. |
| "I'll remember why this file matters." | The next task won't; it has none of your context. Write it in the journal. |
| "Let me just read the whole module to be safe." | That's how the budget evaporates. Grep, read the range, move on. |
| "It's a small change — no journal entry needed." | Small undocumented changes are exactly what confuses the next task. Log it. |
| "I'll skip the budget check this once." | The check is the only thing between you and a mid-task wall. Every task. No exceptions. |
| "The handoff prompt should include everything." | A bloated handoff defeats the point. Point at the files; keep the prompt tiny. |
| "I'll re-read the journal later if I need it." | Read it *first*, on resume, before touching code. Late orientation = wasted budget. |

## Integration

- **`/writing-plans.md`** — produces the plan you save to `.cline/plan.md`. Required if you don't already have one. Make sure its tasks are small.
- **`/test-driven-development.md`** — each code task follows it.
- **`/verification-before-completion.md`** — before checking off each task, and over the whole change at the end.
- **`/finishing-a-development-branch.md`** — once every task is checked off.
- **`/subagent-driven-development.md`** / **`/dispatching-parallel-agents.md`** — upstream subagent-based skills; in Cline they are redirect stubs that point here. (Original versions at obra/superpowers if you ever run a subagent-capable harness.)

## When to Use / Not Use

**Use when:** the codebase is large, the change spans many files or steps, your model's context window is small, or you've already hit the wall on this work once.

**Don't bother when:** the whole task comfortably fits in one session — the file ceremony isn't worth it. Just do it (run `/ultrathink.md` first if it's hard, but you don't need the disk-backed relay).
