---
name: dispatching-parallel-agents
description: Use when facing 2+ independent problems. In Cline this mostly doesn't apply - Cline runs subtasks one at a time, with no parallelism to exploit; see long-haul-development for the sequential relay discipline.
---

# Dispatching Parallel Agents → not applicable in Cline

The upstream version of this skill is about investigating several independent problems **in parallel** — one agent per problem, all running at once. Cline runs subtasks sequentially, so there's no parallelism to exploit. The skill doesn't translate.

What still applies, done one at a time:

- Give each independent problem its own self-contained brief (don't make it inherit your conversation).
- Isolate each in its own `/newtask` subtask so one investigation's context doesn't pollute the next.
- Review and integrate the results when they come back — check that the fixes don't conflict, run the full suite.

That's exactly the relay discipline in [`/long-haul-development.md`](long-haul-development.md). For a handful of independent fixes you can also just do them as plain sequential tasks. If you ever run a harness with real parallel agents, get the original from [obra/superpowers](https://github.com/obra/superpowers).
