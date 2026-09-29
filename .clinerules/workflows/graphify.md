---
description: >
  Turn a codebase, its docs, schemas, configs and PDFs into a queryable
  knowledge graph. Wraps the `graphify` Python CLI — which is NOT installed
  in this environment; see STATUS below. Use when asked to map, visualise
  or query how a codebase connects. Upstream: Graphify-Labs/graphify.
argument-hint: "[path] [--update|--query \"…\"]"
---

# Graphify (Cline workflow)

## STATUS — read this first

**The `graphify` CLI is not installed in this environment.** Verified 2026-09-29:

| Check | Result |
|---|---|
| `python3 --version` | 3.14.4 ✅ (3.10+ required) |
| `python3 -m pip --version` | **`No module named pip`** ❌ |
| `which pip3` / `which pipx` | not on PATH ❌ |
| `which graphify` | not installed ❌ |

So this workflow is installed; the tool it drives is not. **Every command below will fail
with "command not found" until the CLI is installed.** Do not claim a graph was built.

To install it (needs a working `pip` or `pipx`):

```bash
pipx install graphifyy     # preferred: isolates the deps
# or
python3 -m pip install graphifyy
python3 -m ensurepip --upgrade    # if pip is genuinely missing
```

The PyPI name is `graphifyy` (double-y) while `graphify` is being reclaimed; the CLI
command is still `graphify`.

Upstream has **no Cline target** — its `graphify <agent> install` list covers claude,
codex, cursor, gemini, opencode, windsurf, kilo, copilot, droid, amp, kiro and others,
but not Cline. This file is the Cline adaptation, hand-written to the same commands.

## What it does

Builds a local knowledge graph from a folder — code via tree-sitter AST parsing, docs/PDFs
via LLM extraction — and hands back `graph.html` (interactive), `graph.json` (queryable
later), `GRAPH_REPORT.md` (god nodes, surprising connections, suggested questions), and
optionally an Obsidian vault or a Wikipedia-style wiki. Every edge is tagged `EXTRACTED`,
`INFERRED`, or `AMBIGUOUS`, so it is always clear what was found versus guessed.

## Commands

Once installed:

```bash
graphify .                        # build from the current directory
graphify ./raw                    # a specific folder
graphify . --update               # re-extract only changed files, merge into the graph
graphify . --watch                # auto-sync as files change

graphify query "what connects the lead run to the CRM?"
graphify path "DigestAuth" "Response"
graphify explain "SwinTransformer"
```

Other useful flags: `--wiki` (agent-crawlable articles + `index.md`), `--svg`, `--graphml`,
`--neo4j` (emits `cypher.txt`), `--mcp` (stdio MCP server), `--mode deep` (more aggressive
`INFERRED` edges), `--token-budget N`, `--max-workers N`, `--no-gitignore`.
`graphify extract <path>` is the headless form for CI, with `--backend` for
gemini / ollama / openai / claude / bedrock / claude-cli.

Output lands in `graphify-out/`. **Add it to `.gitignore`** if it isn't already — it
contains a cache and generated HTML, not source.

## When to use it in this repo

Genuinely useful here, because the questions this app keeps asking are structural:

- "what depends on `useLeads`?" — the 7 files importing `@/app/(shell)/leads/hooks/`
- "what would break if I moved `readTodaysLeadRun`?" — its callers across `/api/lead-runs` and the driver page
- "which pages read `saved_locations`?" — the 12 call sites the pin→customer migration has to keep working

That last one is the strongest case: spec 3's risk section turns on enumerating every
reader of a table, and that is precisely a call-graph question.

## Boundaries

Graphify is a **read-only analysis tool**. It writes to `graphify-out/` and nothing else —
it does not modify source, does not run the app, and does not touch the database. Treat
its output as a map, not as truth: it is AST-derived and LLM-extracted, so verify anything
load-bearing (a claim about who calls what) with `grep` before acting on it.

`graphify hook install` adds a **post-commit git hook that rebuilds the graph on every
commit**. Do not run that in this repo without asking — it changes git behaviour for
every future commit and the project already has an auto-commit hook in
`.claude/hooks/auto-commit-push.sh`.

Upstream: https://github.com/Graphify-Labs/graphify
