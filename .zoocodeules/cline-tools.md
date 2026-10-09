---
name: cline-tools
description: Tool-name mapping - workflow text uses Claude Code tool names; this maps them to Cline equivalents.
---

# Cline Tool Mapping

The workflows in this library were ported from a Claude Code skill set. Where a workflow refers to a Claude Code tool, use the Cline equivalent below.

| Workflow says (Claude Code) | In Cline, do this |
|---|---|
| "Use the `Skill` tool" / "invoke the X skill" / "REQUIRED SUB-SKILL: X" | Run the `/X.md` workflow (type `/X.md` in chat). |
| `TodoWrite` / "create a todo" / "track with todos" | Use Cline's built-in todo list / focus chain. |
| `Task` tool / "dispatch a subagent" / "dispatch an agent" | Start a Cline subtask with `/newtask` (or the `new_task` tool). Cline runs subtasks **sequentially**, not in parallel — keep the isolation discipline, drop the wall-clock-parallelism expectation. |
| `EnterPlanMode` / `ExitPlanMode` / "present a plan" | Toggle Cline's **Plan** mode to design, then switch to **Act** mode to execute. |
| `Read` / `Glob` / `Grep` | Cline's `read_file`, `list_files`, `search_files` (or `<read_file>` / `<search_files>` XML tool calls inside a workflow). |
| `Edit` / `Write` | Cline's `replace_in_file` / `write_to_file`. |
| `Bash` / "run a command" | Cline's `execute_command` (or `<execute_command>` inside a workflow). |
| `AskUserQuestion` / "ask your human partner" | Cline's `ask_followup_question` (or `<ask_followup_question>`). |
| MCP tool calls | Cline's `use_mcp_tool` / `<use_mcp_tool>`. |
| Plugin paths like `${CLAUDE_PLUGIN_ROOT}/...` | Paths are relative to the repo: `.clinerules/workflows/<skill>/...`. |
| "your human partner" | The user. Keep treating them as a collaborator, not a command source to obey blindly. |

## On subtasks vs. subagents

Cline has no subagents. `/newtask` gives you **context isolation** (a fresh task with exactly the brief you write) but it's a one-way baton pass — there's no parent that stays alive and collects results, and **no parallelism** (one task at a time).

- `/subagent-driven-development.md` and `/dispatching-parallel-agents.md` (upstream skills built on parallel subagents) are **redirect stubs** here — both point at `/long-haul-development.md`, which gets the parts that matter (one isolated context per unit of work, review gates) via a sequential `/newtask` relay plus disk-backed state.
- `/requesting-code-review.md` says "dispatch a code reviewer subagent" — in Cline, either do an explicit fresh-eyes self-review pass, or relay a review-only `/newtask`.
- General rule: keep the discipline ("one isolated unit of work per subtask, self-contained brief, review between units"); drop the framing ("run concurrently", "time saved by parallelism").
