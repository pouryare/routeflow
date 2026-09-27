# Persian Copy Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a re-runnable generator that produces a complete catalogue of every on-screen Persian string in the app, flags stale/misused/retired copy mechanically, and is guarded against drift — plus a hand-written summary of what needs human judgement.

**Architecture:** A Node script (`scripts/audit-copy.mjs`) reuses the route-walker proven by `tests/pageMeta.test.ts` (not a rewrite of it), walks each shell route to its `.tsx` and the shared `lib/` label maps it imports, extracts Persian string literals and template-literal fragments containing Persian, applies seven detectors (retired-word, raw-enum, Arabic-char, ZWNJ-inconsistent, stale-surface, unlabelled-enum, OK), and writes a generated `catalogue.md`. A vitest (`tests/copyAudit.test.ts`) makes regeneration deterministic, completeness mandatory, and every flag explainable. `docs/copy-audit/summary.md` is hand-written.

**Tech Stack:** Node (>=18), no new deps — only `node:fs`, `node:path`, `node:crypto`. Vitest. TypeScript source parsed with regex (deliberate: the codebase's own audit scripts do this; no AST tooling is installed). Persian range `\u0600-\u06FF`.

Files:
- Create `scripts/audit-copy.mjs` — generator
- Create `docs/copy-audit/catalogue.md` — generated output (do not hand-edit)
- Create `docs/copy-audit/summary.md` — hand-written
- Create `tests/copyAudit.test.ts` — guards
- Modify `package.json` — add `audit-copy` script

---

### Task 1: Create the generator skeleton and route walker

**Files:** Create `scripts/audit-copy.mjs`; Create `tests/copyAudit.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/copyAudit.test.ts` first, so the generator has a contract).

The test walks `app/(shell)` routes the same way `tests/pageMeta.test.ts` does, runs the generator, and asserts: exits cleanly, writes a catalogue, covers every shell route.

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "audit-copy.mjs");
const OUT = join(ROOT, "docs", "copy-audit", "catalogue.md");

function staticRoutes(dir: string, base = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = `${base}/${e.name}`;
    if (!e.isDirectory()) return [];
    if (e.name.startsWith("[")) return [];
    if (e.name.startsWith("(")) return staticRoutes(join(dir, e.name), base);
    const url = `${base}/${e.name}`;
    const out = existsSync(join(dir, e.name, "page.tsx")) ? [url] : [];
    return [...out, ...staticRoutes(join(dir, e.name), url)];
  });
}

describe("copy audit generator", () => {
  it("exits cleanly", () => {
    expect(() => execFileSync("node", [SCRIPT])).not.toThrow();
  });

  it("writes a catalogue", () => {
    expect(existsSync(OUT)).toBe(true);
  });

  it("covers every shell route", () => {
    const routes = staticRoutes(join(ROOT, "app", "(shell)"));
    const cat = readFileSync(OUT, "utf8");
    for (const r of routes) expect(cat, r).toContain(`## ${r}`);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run tests/copyAudit.test.ts` should fail (no script / no output).

- [ ] **Step 3: Implement the generator skeleton** — route walker + Persian extractor that writes a placeholder catalogue. The script must read `node:fs` explicitly as UTF-8 (the codebase has `lib/repo/notifications.ts` as a 38 KB binary-sized file that grep treats as binary).

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PERSIAN = /[\u0600-\u06FF]/;

function readUtf8(p) { return fs.readFileSync(p, "utf8"); }
function walk(dir, base = "") { ... }
```

- [ ] **Step 4: Run the test; confirm the route-coverage invariant passes and the catalogue is non-empty.**

- [ ] **Step 5: Commit** — `feat(copy-audit): generator skeleton + route walker + passing test`.

---

### Task 2: Add the label-map collector

**Files:** Extend `scripts/audit-copy.mjs`

The catalogue must read the shared `lib/` label maps (`PAGE_META`, `ORDER_STATUS_LABEL`, `ROLE_LABEL`, etc.), not just walk `.tsx`. Strategy:
- Build the set of on-screen routes from the shell walker.
- For each `.tsx`/component that renders a route, read its source; collect Persian strings from **string literals only** (template literals get their Persian fragments).
- Collect shared-label-map strings by reading the known `*_LABEL` / `*_META` / `PAGE_META` constants from `lib/`.

- [ ] **Step 1: Write a focused test** capturing that strings from `lib/pageMeta.ts` and `lib/orderStateMachine.ts` appear in the catalogue.

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `collectLabelMaps()`** — read `PAGE_META`, all `Record<..., string>` Persian maps in `lib/`, dedupe by first-seen location.

- [ ] **Step 4: Run full `tests/copyAudit.test.ts`; both new cases green.**

- [ ] **Step 5: Commit** — `feat(copy-audit): collect shared label maps from lib/`.

---
### Task 3: Implement the 7 detectors

**Files:** Extend `scripts/audit-copy.mjs`

Each detector is pure and unit-testable on a sample string. The ZWNJ detector must tokenize on whole-word stems, so `لغوشده` and `لغو‌شده` are recognised as the same stem.

- [ ] **Step 1: Write failing tests in `tests/copyAudit.test.ts`** — one sample string per detector.

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement detectors:**

```js
function stripComments(src) { /* block + // line (but not :// ) */ }
function detectZWNJInconsistent(allStrings) { /* tokenise stems, compare */ }
function detectRetiredWord(line) { /* reuse vocabulary.test RETIRED patterns */ }
function detectRawEnum(src) { /* reuse no-raw-enum-copy bare regexes */ }
function detectArabicChars(str) { /[\u0649\u0643\u064a\u0629]/.test(str) }
function detectStaleSurface(route, routes, pageMeta) { /* route unreachable or stub */ }
function detectUnlabelledEnum(src) { /* enum member not in any *_LABEL map */ }
```

- [ ] **Step 4: Run full suite; all green.**

- [ ] **Step 5: Commit** — `feat(copy-audit): seven flag detectors`.

---

### Task 4: Emit the catalogue and make regeneration stable

**Files:** Extend `scripts/audit-copy.mjs`; Create `docs/copy-audit/catalogue.md`

- [ ] **Step 1: Add a determinism test** — regenerate to a temp file; `expect(diff).toBe("")`.

- [ ] **Step 2: Implement catalogue writer** — group by screen, sort by status, columns: screen / string / defined-at / status / detector / note.

- [ ] **Step 3: Run `node scripts/audit-copy.mjs` twice; catalogue is byte-stable.**

- [ ] **Step 4: Add `audit-copy` script** to `package.json` → `"audit-copy": "node scripts/audit-copy.mjs"`.

- [ ] **Commit** — `feat(copy-audit): generate catalogue + npm script`.

---

### Task 5: Write the hand-written summary

**Files:** Create `docs/copy-audit/summary.md`

Contents:
- The 3 stale surfaces, each with evidence and your approved recommendation (delete `/analytics`, `/sales/analysis`; keep `/sales/admin/representatives` as redirect).
- The ZWNJ inconsistencies found (`لغوشده` in 3 files).
- Arabic-char offenders (4 files).
- A note that the script cannot judge "wrong translation" — list the candidates that need a human ear, grouped by screen.

- [ ] **Step 1: Read the generated catalogue, extract the flagged rows.**

- [ ] **Step 2: Write `summary.md`.**

- [ ] **Step 3: Commit** — `docs(copy-audit): hand-written summary of flagged copy`.

---

### Task 6: Final verification

- [ ] `npm run audit-copy` exits 0
- [ ] `docs/copy-audit/catalogue.md` exists, contains every shell route
- [ ] `tests/copyAudit.test.ts` is green
- [ ] Full suite green (your journal warned the vocabulary test is only caught by the full suite): `npm test`
- [ ] Regeneration is byte-identical

## Out of scope (separate follow-ups)
- Nav-bar per-role personalization → separate spec
- Deleting the stale pages → your approval first
- Any `app/` runtime code changes
