# Communication & Reporting Rules

## Explanation Style (ELI5 - Explain Like I'm 5)
- Avoid overly dense technical jargon without explaining it first using everyday analogies (e.g., compare APIs to restaurant waiters, variables to labeled boxes).
- Break complex programming concepts into simple, intuitive ideas.

## Response Structure & Depth
- Provide comprehensive, longer explanations rather than brief summaries. Do not shortcut or truncate details.
- Always include concrete code examples showing both BEFORE and AFTER states when making or suggesting changes.
- End every task report with a summary structured into three distinct parts:
  1. **What was changed?** (Detailed plain-language walkthrough)
  2. **Why was it done this way?** (The core reason and underlying principle)
  3. **Real-World Analogy & Example** (An easy-to-understand analogy illustrating the concept)

## Machine Constraints — THIS PC CANNOT BUILD

**Never run `next build` (or `npm run build`, or any production build) on this machine.**
It is too slow to finish here, and it was cancelled on 2026-09-29 after running for
several minutes without completing.

**Use these instead, and nothing else, to verify a change:**

| Purpose | Command | Time |
|---------|---------|------|
| Type safety | `npx tsc --noEmit` | ~2 min, **zero errors = pass** |
| Tests | `npx vitest run` | ~14 min, 2,737 tests — run in the **background** and poll the log |
| Quick subset | `npx vitest run tests/<name>.test.ts` | seconds |

**Also slow:** the full vitest suite takes ~14 minutes. Launch it detached
(`setsid nohup … &`), then poll the log file — do not run it in the foreground, and do not
assume a foreground command that "timed out" means the test failed. It very likely kept
running. Same for `tsc` and anything over ~30s: the shell has a ~30s cap, so long commands
need backgrounding.

### Two tests flake under full-suite load — this is expected, not a regression

With all 356 files competing for this machine's cores, two tests exceed vitest's 5-second
default and fail with `Test timed out in 5000ms`:

- `tests/jalali.test.ts` → *"agrees with Intl for every day across 20 Jalali years"*
- `tests/api/routing-route.test.ts` → *"plans, commits and freezes"*

**Both pass when run alone** (19/19 and 3/3). They are pure CPU contention, and they have
no relation to any dependency or code change. So:

- A run reporting **2 failed / 2735 passed** with those two names is a **pass**.
- Before reporting a failure, re-run the file alone: `npx vitest run tests/<file>`.
  Only a failure that reproduces in isolation is real.
- Do not "fix" them by raising the global timeout to paper over slowness.

**Do not** run `next build`, `next start`, or the Playwright smoke suite
(`vitest.smoke.mts` — it boots a browser and a dev server). If a task seems to need a
production build to be verified, say so and use `tsc --noEmit` plus the test suite instead.

### The `sharp` pin — do not "upgrade" it away

`sharp` is pinned to **exactly `0.33.5`** (`--save-exact`) in `package.json`.

This machine's CPU has **no AVX2** (`grep -c avx2 /proc/cpuinfo` → 0). sharp ≥ 0.35 ships
prebuilt x86-64-V2-only binaries and fails at import:

```
Could not load the "sharp" module using the linux-x64 runtime
Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture
```

That breaks `app/api/photos/route.ts` and `app/api/payments/[id]/receipt/route.ts`, and
**fails `tests/api/scoping.test.ts`** (51 tests) because that suite imports the photos
route.

This bit us once already: the dependency was `^0.35.3`, so a plain `npm install` floated it
to 0.35.5 and silently reintroduced the failure — which then failed one test file and,
separately, made `next build` fail at page-data collection. **That is why the pin is
exact.** If it ever drifts back to a caret range, restore it with
`npm install sharp@0.33.5 --save-exact`.

The same CPU limitation applies to **Python**: numpy ≥ 2.4 ships V2-only wheels and dies on
import. `graphify` needs numpy pinned to `2.3.5` — see
`.clinerules/workflows/graphify.md`.
