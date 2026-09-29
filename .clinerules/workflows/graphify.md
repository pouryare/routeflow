---
description: >
  Turn a codebase, its docs, schemas, configs and PDFs into a queryable
  knowledge graph. Wraps the `graphify` Python CLI, which IS installed and
  verified on this machine; needs --code-only and a numpy pin, see STATUS.
  Use when asked to map, visualise or query how a codebase connects.
  Upstream: Graphify-Labs/graphify.
argument-hint: "[path] [--code-only]"
---

# Graphify (Cline workflow)

## STATUS — installed and verified, with one CPU caveat

**Verified working on this machine, 2026-09-29.** `graphifyy 0.9.71` is installed to
`~/.local/lib/python3.14/site-packages/`, the `graphify` command is at
`~/.local/bin/graphify`, and an end-to-end run on a two-file fixture produced
`graph.json` with 6 nodes / 5 edges / 2 communities. `explain` and `path` both return
correct results.

```bash
export PATH="$HOME/.local/bin:$PATH"   # not on the default PATH
graphify --version                      # 0.9.71
```

### How it was installed here

Ubuntu 26.04 ships `python3.14-minimal`, which has **no pip, no ensurepip, and no venv**,
and is PEP 668 "externally managed". `apt install` needs a password. The working path,
with no sudo:

```bash
curl -fsSL https://bootstrap.pypa.io/pip/pip.pyz -o /tmp/pip.pyz
python3 /tmp/pip.pyz install --user --break-system-packages pip
export PATH="$HOME/.local/bin:$PATH"
pip install --user --break-system-packages graphifyy
```

`get-pip.py` alone does **not** work here — it hits the PEP 668 marker. The `pip.pyz`
zipapp is what gets past it, and `--user` keeps it out of system site-packages.

### ⚠️ The CPU caveat: numpy must be pinned below 2.4

This machine has **no AVX2** (`grep -c avx2 /proc/cpuinfo` → 0). numpy ≥ 2.4 ships
x86-64-V2-only wheels and dies on import:

```
RuntimeError: NumPy was built with baseline optimizations: (X86_V2)
              but your machine doesn't support: (X86_V2).
```

That error surfaces *during* a graphify run, not at install time, and it kills extraction
mid-flight while the exit code still reads 0. graphify itself pulls numpy unpinned, so
after any `pip install -U` it will come back. **Pin it:**

```bash
pip install --user --break-system-packages --no-deps \
  "numpy==2.3.5" -f /tmp/wheels      # or: pip install "numpy<2.4" --only-binary=:all:
```

`numpy<2.3` will **not** work — no cp314 wheel exists, so pip tries to build from source
and dies on a missing meson dependency. 2.3.5 is the last version with a wheel, and it
imports cleanly without AVX2.

### The same CPU limitation hit this project's own build

`next build` originally failed here with:

```
Error: Failed to collect configuration for /api/payments/[id]/receipt
  [cause]: Could not load the "sharp" module using the linux-x64 runtime
  Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture
```

**That was sharp, not numpy** — same V2-only binary problem, different package. It broke
`/api/payments/[id]/receipt` and `/api/photos`, and it failed `tests/api/scoping.test.ts`
(51 tests), because that suite imports the photos route.

It was *not* a pre-existing condition: `sharp` was declared as `^0.35.3`, a fresh
`npm install` floated it to 0.35.5, and 0.35.x requires V2. **sharp is now pinned to
exactly `0.33.5`**, which loads fine and restores all 51 tests. The rule and the reasoning
live in `.clinerules/report.md` under "Machine Constraints" — read that before touching
dependencies.

In short: this machine has no AVX2, and it is the reason numpy is pinned for graphify and
sharp is pinned for the app.


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

Output lands in `graphify-out/`, which is already in this repo's `.gitignore` (the rule
also catches it nested, e.g. `lib/graphify-out/` when you pass several paths). It contains
a SHA256 cache and generated JSON, not source — keep it that way.

### Running it on this repo — two flags matter

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /home/pourya/Desktop/routeflow
graphify lib components app --code-only --no-gitignore
```

**`--code-only` is required.** Without it, graphify finds 1 markdown file among the 227
code files and then fails, because semantic doc extraction needs an LLM API key
(`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). A code-only corpus needs
no key and no network. Verified result: **2,094 nodes, 4,697 edges, 120 communities**
from `lib` + `components` + `app`.

**It writes to the FIRST path you name**, so the above puts it in `lib/graphify-out/`.
Pass a single `.` if you want it at the repo root.

### It independently confirms spec 3

```
$ graphify explain "foldLeadPinsIntoCustomers" --graph lib/graphify-out/graph.json
Node: foldLeadPinsIntoCustomers()
  Source: db.ts L632
  Connections (2):
  <-- getDb() [calls] [EXTRACTED] db.ts:L3077
  <-- db.ts [contains] [EXTRACTED] db.ts:L632
```

One caller, at `db.ts:3077` — which is the one-shot guard in spec 3 §1.1. Read this as a
*map*, though: it is AST-derived, so it shows calls and containment, **not** the SQL a
function executes. It cannot tell you which tables a query touches, which is the question
spec 3 actually turns on. Use it for call graphs, and `grep` for data.


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
