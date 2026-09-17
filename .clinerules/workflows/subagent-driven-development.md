---
name: subagent-driven-development
description: Use when executing an implementation plan task-by-task with review gates. In Cline, redirects to long-haul-development - Cline has no parallel subagents, so the original controller-with-workers pattern has no mechanism here.
---

# Subagent-Driven Development → use `/long-haul-development.md`

The upstream version of this skill drives a plan by **dispatching a fresh subagent per task** with two-stage review (spec compliance, then code quality), all coordinated by a controller that stays alive. Cline has no subagents — `/newtask` is a one-way baton pass, not a parent-and-worker — so that pattern has nothing behind it here.

**Use [`/long-haul-development.md`](long-haul-development.md) instead.** It keeps the parts that actually matter:

- one isolated context per task (a fresh `/newtask`, given only the brief it needs)
- a review gate before each task is checked off (self-review + `/verification-before-completion.md`; relay a review-only task if a task warrants outside eyes)
- continuous task-by-task execution from a written plan

…plus it adds what you need on a real codebase: the plan and progress live on disk (`.cline/plan.md`, `.cline/journal.md`), and it relays across `/newtask` tasks so the whole job stays under your context budget.

If you ever run a harness that *does* have real parallel subagents, get the original from [obra/superpowers](https://github.com/obra/superpowers).
