---
name: mcp
description: Routing guide for the 14 installed MCP servers - which one to reach for, which built-in tool wins, and the traps that cost a wasted round trip. Loaded into every task automatically.
---

# MCP Servers: which to reach for

14 servers, 128 tools, installed 2026-09-29 and verified by `initialize` + `tools/list`
handshake against every entry. Config:
`~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`.

**You do not need this file to know the tools exist.** Cline already injects every MCP
tool's name and full schema into your context automatically, and you call them through
`use_mcp_tool` with `serverName` + `toolName`. Nothing here re-lists the schemas.

This file exists for the three things a schema cannot tell you: **which server wins**,
**which built-in tool beats it**, and **the traps**.

## Reach for the built-in tool first

This is the rule that matters most. Several MCP servers duplicate a tool Cline already
has, and the built-in is usually better — it needs no server start-up, and its result is
already in your context.

| Instead of | Use | Why |
|---|---|---|
| `ripgrep` MCP (`search`, `advanced-search`) | `search_files` | Cline's own. The MCP wraps a shell `rg` and gives you raw text. |
| `shell` MCP (`execute_shell_command`) | `execute_command` | Same thing, with Cline's output capture and backgrounding. |
| `git` MCP (`git_diff`, `git_log`, `git_status`) | `execute_command` + `git --no-pager` | I already have the repo; a shell call is one round trip, not a server handshake. |
| `ts-codemod` (`references`, `definition`, `quickinfo`) | `search_codebase`, `read_files` | The MCP's TS-server tools work, but cost a handshake and are slower. |
| `playwright` MCP | `execute_command` + `curl` | For "does this URL return 200", a shell `curl` beats launching a browser. |

**Keep the MCP versions** for what the built-ins cannot do: git history archaeology
(`git_blame`, `git_log` with revision ranges), browser interaction, refactors, SQL.

## When the MCP genuinely wins

| Server | Use it for | Key tools |
|---|---|---|
| `dbhub` | **Any question about the data.** Schema, row counts, "why is this customer missing". | `execute_sql` |
| `git` | History questions the shell makes clumsy: who wrote this line, what changed between two commits, bisect. | `git_blame`, `git_log`, `git_show`, `git_diff`, `git_stash` |
| `ts-codemod` | Safe mechanical refactors: extract a function, inline a variable, move a symbol, organize imports. | `extractFunction`, `inlineVariable`, `moveSymbol`, `organizeImports`, `getEditsForFileRename` |
| `ast-grep` | Structural search — "find every `await` inside a try block", by syntax not by text. Survives renames; regex does not. | `ast_grep_search`, `ast_grep_scan` |
| `playwright` | Real browser behaviour: JS errors, console output, network calls, screenshots. | `browser_navigate`, `browser_console_messages`, `browser_network_requests`, `browser_take_screenshot` |
| `context7` | Up-to-date library docs — this project's `next@16` and `tailwindcss@4` are past your training data. **Check here before guessing an API.** | `resolve-library-id`, `query-docs` |
| `eslint` | Lint a specific set of files, get rule-explanations, not just pass/fail. | `lint-files` |
| `tailwind` | Validate or suggest Tailwind classes, read the theme. | `suggest_classes`, `validate_classes`, `get_theme` |
| `next-devtools` | Next.js 16 App Router internals, `nextjs_docs`, runtime `browser_eval`. | `nextjs_docs`, `nextjs_index`, `nextjs_call` |
| `next-bundle-analyzer` | Bundle size, duplicate packages, tree-shaking. | `analyze_bundle`, `find_large_modules` |
| `sequential-thinking` | **Only** a genuine multi-step unknown. Costs a turn; do not use it to think about a known thing. | `sequentialthinking` |
| `memory` | Facts that must survive this task: user preferences, decisions and their reasons. | `create_entities`, `create_relations`, `search_nodes`, `read_graph` |

## Traps — these have already cost time

**`dbhub` is READ-ONLY and reads a SNAPSHOT, never the live database.**
`data/routeflow.db` is production data in WAL mode. The server points at
`.cline/mcp/routeflow-mcp.db`, a copy taken with SQLite's backup API. Consequences:

- Writes are rejected. To change data, edit the app and run a migration — do not try to
  `INSERT`/`UPDATE` through this server.
- The snapshot goes **stale** after a deploy. Refresh it:
  `bash .cline/mcp/refresh-db-snapshot.sh`
- If `SELECT` returns "unable to open database file", the DSN in `.cline/mcp/dbhub.toml`
  lost a slash. An absolute path needs exactly three: `sqlite:///home/...` — not four.

**This machine has no AVX2.** `sharp` is pinned to exactly `0.33.5` for that reason. Never
float it to `^0.35.x` — the prebuilt binaries need AVX2, fail at import, and take
`app/api/photos/route.ts` and the payments receipt route down with them.

**`next build` cannot run here.** It was cancelled on 2026-09-29 after minutes without
finishing. Use `npx tsc --noEmit` and `npx vitest run`. This means `next-bundle-analyzer`
needs an existing `.next` build to analyse — it cannot produce one for you.

**Never run the Playwright smoke suite** (`vitest.smoke.mts`) — it boots a browser and a
dev server. Background anything over ~30s (`setsid nohup … &`); the shell has a ~30s cap
and a foreground "timeout" almost always means it is still running.

**Two tests flake under full-suite load and both pass alone** — `tests/jalali.test.ts`
("agrees with Intl for every day across 20 Jalali years") and
`tests/api/routing-route.test.ts` ("plans, commits and freezes"). `2 failed / 2735 passed`
with those two names **is a pass**. Re-run a file alone before believing a failure.

**`git` MCP is pinned to this repo** (`--repository /home/pourya/Desktop/routeflow`) and
exposes `git_clear_working_dir`. It can discard uncommitted work. Prefer `git_status` and
`git_diff` for inspection; reach for destructive tools only when asked directly.

## Not installed

- **Biome** has no MCP server — not old, not misconfigured. 2.5.14 is the latest release
  and its CLI has no `mcp` subcommand. Use the `biome` binary directly, or the `eslint` MCP.
- **JSON Schema / Zod generator** — no such server exists on npm. `zod` is present in
  `node_modules` (transitively, not a declared dependency), so schemas are writable by
  hand; there is no MCP tool to generate them.

