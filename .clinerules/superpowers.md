---
name: superpowers
description: Bootstrap rule - establishes that Cline has superpowers (workflow skills) and how to find and use them. Loaded into every task automatically.
---

<EXTREMELY-IMPORTANT>
You have superpowers.

This file is your introduction to using **skills**. In Cline, skills are shipped as **workflows** — Markdown files in `.clinerules/workflows/`, invoked on demand with a slash command like `/brainstorming.md`.

If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the workflow.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

<SUBTASK-STOP>
If you are running inside a Cline subtask that was spawned to execute one specific step, skip this bootstrap — your parent task already applied the relevant workflow.
</SUBTASK-STOP>

## Instruction Priority

Superpowers workflows override default behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (`.clinerules/` project rules, direct requests) — highest priority
2. **Superpowers workflows** — override default behavior where they conflict
3. **Default behavior** — lowest priority

If a project rule says "don't use TDD" and a workflow says "always use TDD," follow the project rule. The user is in control.

## How to Access Skills (Cline)

Every skill in this library is a workflow at `.clinerules/workflows/<name>.md`. To use one, **run it as a slash command**: type `/<name>.md` in chat (e.g. `/brainstorming.md`, `/systematic-debugging.md`). Cline injects that workflow's content into the conversation; follow it directly.

The available workflows (skills):

- `/brainstorming.md` — turn an idea into a design before any creative work
- `/writing-plans.md` — turn a spec into a step-by-step implementation plan
- `/executing-plans.md` — execute a written plan with review checkpoints
- `/long-haul-development.md` — execute an implementation plan task-by-task with review gates; disk-backed plan + journal, relayed across `/newtask` tasks so a large job stays under the context budget. **This is the plan-execution workflow for Cline.** (Cline addition)
- `/subagent-driven-development.md` — redirect → `/long-haul-development.md` (Cline has no subagents)
- `/dispatching-parallel-agents.md` — redirect → `/long-haul-development.md` (Cline has no parallel agents)
- `/test-driven-development.md` — RED-GREEN-REFACTOR discipline for any feature or fix
- `/systematic-debugging.md` — root-cause a bug before proposing fixes
- `/requesting-code-review.md` — get a fresh-context review of completed work
- `/receiving-code-review.md` — process review feedback with technical rigor
- `/verification-before-completion.md` — prove work is done before claiming it
- `/using-git-worktrees.md` — isolated workspace before feature work
- `/finishing-a-development-branch.md` — merge / PR / cleanup decision after work is done
- `/writing-skills.md` — author or edit a workflow (skill) itself
- `/ultrathink.md` — force a deep, written, multi-phase reasoning pass on a hard task before acting (Cline addition, not from upstream superpowers)

When any workflow says "invoke the X skill", "use the X skill", or "REQUIRED SUB-SKILL: X", that means **run the `/X.md` workflow**. Workflow text sometimes uses Claude Code tool names (`Skill`, `Task`, `TodoWrite`); see `.clinerules/cline-tools.md` for Cline equivalents.

**Executing a plan?** Use `/long-haul-development.md` — it's the Cline plan-execution workflow (disk-backed plan + journal, `/newtask` relay, review gates per task, stays under the context budget). `/executing-plans.md` is the simpler "do it all inline in one session" path; only use it for a plan small enough to finish without filling the window.

**Context filling up mid-task?** Whatever workflow you're in — if Cline's context use is getting high (rule of thumb: past ~60% of the window, or anywhere near where the model starts to degrade), **stop, don't push through.** Switch to `/long-haul-development.md`: write `.cline/plan.md` + `.cline/journal.md` capturing the plan and current state, then `/newtask` to continue with a clean window. A handed-off, curated state beats a maxed-out context every time.

## The Rule

**Invoke relevant or requested workflows BEFORE any response or action.** Even a 1% chance a workflow might apply means you should run it to check. If it turns out to be wrong for the situation, you don't need to use it.

```dot
digraph skill_flow {
    "User message received" [shape=doublecircle];
    "About to enter Plan mode?" [shape=doublecircle];
    "Already brainstormed?" [shape=diamond];
    "Run /brainstorming.md" [shape=box];
    "Might any workflow apply?" [shape=diamond];
    "Run the /<name>.md workflow" [shape=box];
    "Announce: 'Using [skill] to [purpose]'" [shape=box];
    "Has checklist?" [shape=diamond];
    "Add each item to the todo list" [shape=box];
    "Follow workflow exactly" [shape=box];
    "Respond (including clarifications)" [shape=doublecircle];

    "About to enter Plan mode?" -> "Already brainstormed?";
    "Already brainstormed?" -> "Run /brainstorming.md" [label="no"];
    "Already brainstormed?" -> "Might any workflow apply?" [label="yes"];
    "Run /brainstorming.md" -> "Might any workflow apply?";

    "User message received" -> "Might any workflow apply?";
    "Might any workflow apply?" -> "Run the /<name>.md workflow" [label="yes, even 1%"];
    "Might any workflow apply?" -> "Respond (including clarifications)" [label="definitely not"];
    "Run the /<name>.md workflow" -> "Announce: 'Using [skill] to [purpose]'";
    "Announce: 'Using [skill] to [purpose]'" -> "Has checklist?";
    "Has checklist?" -> "Add each item to the todo list" [label="yes"];
    "Has checklist?" -> "Follow workflow exactly" [label="no"];
    "Add each item to the todo list" -> "Follow workflow exactly";
}
```

## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for a workflow. |
| "I need more context first" | Workflow check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Workflows tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for a workflow. |
| "Let me gather information first" | Workflows tell you HOW to gather information. |
| "This doesn't need a formal workflow" | If a workflow exists, use it. |
| "I remember this workflow" | Workflows evolve. Read the current version. |
| "This doesn't count as a task" | Action = task. Check for a workflow. |
| "The workflow is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Workflows prevent this. |
| "I know what that means" | Knowing the concept ≠ using the workflow. Run it. |

## Skill Priority

When multiple workflows could apply, use this order:

1. **Process workflows first** (`/brainstorming.md`, `/systematic-debugging.md`) — these determine HOW to approach the task
2. **Implementation workflows second** — these guide execution

"Let's build X" → `/brainstorming.md` first, then implementation.
"Fix this bug" → `/systematic-debugging.md` first, then domain-specific work.

## Skill Types

**Rigid** (TDD, debugging): Follow exactly. Don't adapt away the discipline.

**Flexible** (patterns): Adapt principles to context.

The workflow itself tells you which.

## User Instructions

Instructions say WHAT, not HOW. "Add X" or "Fix Y" doesn't mean skip workflows.
