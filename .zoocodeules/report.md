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

### Tests that flake under full-suite load — expected, not regressions

With all ~405 files competing for this machine's cores, some tests exceed vitest's
5-second default and fail with `Test timed out in 5000ms`.

**Every entry below was re-measured on 2026-10-01, alone, on an idle machine.** The
timings are the idle figures against the 5000ms budget:

| Test | idle | vs budget | verdict |
|---|---|---|---|
| `tests/district-coverage.test.ts` → *"has no interior hole in the net"* | **3222ms** | 64% | genuine contention |
| `tests/api/routing-route.test.ts` → *"plans, commits and freezes"* | **3704ms** | 74% | genuine contention |
| `tests/routing-repo.test.ts` → *"builds a greedy plan ordered nearest-first from the depot"* | **1907ms** | 38% | genuine contention |

**`tests/jalali.test.ts` is no longer on this list — it was never a flake.** It is fixed.
See the note below, because it is the reason this list was rewritten rather than trusted.

Note what "genuine contention" means here: these three do **real work** (a 9,576-cell
point-in-polygon sweep against 22 district polygons; a full routing plan), so their cost
is intrinsic rather than wasted setup. `district-coverage` is the closest to the line at
64% of budget and **does** fail occasionally even on an idle machine — measured 1 failure
in 3 runs — so treat it as the least trustworthy entry here.

**All pass when run alone.** They are CPU contention, and they have no relation to any
dependency or code change. So:

- A run reporting **1–2 failed / rest passed** with those names is a **pass**.
- Before reporting a failure, re-run the file alone: `npx vitest run tests/<file>`.
  Only a failure that reproduces in isolation is real.
- Do not "fix" them by raising the global timeout to paper over slowness.

Note the shape of the trap: the total pass count and the file count both drift as work
lands, so match on the **test name**, never on the counts. A run reporting 1 failure whose
name is NOT on this list is a real failure — that is exactly how
`tests/repo-boundary.test.ts` was caught after the avatar routes.

### A "flake" that fails alone is not a flake — measure before filing

`tests/jalali.test.ts` sat on this list for months as *"passes alone (19/19)"*. That was
never true. Measured on an idle machine, four consecutive runs gave **2 passed, 2 failed**
at 5412ms and 5644ms against the 5000ms budget — a coin flip, which is exactly what made
it look like contention.

The cause was in the test, not the machine. Its oracle helper built a new
`Intl.DateTimeFormat` **per call**, and it is called 7,672 times (once per day across 20
Jalali years). Building a formatter loads ICU locale data at ~2.8ms; the loop therefore
spent **~21 seconds constructing 7,672 identical objects** to perform ~0.3 seconds of
formatting. Hoisting it to module scope: **5859ms → 343ms**, and the file's test time is
now 489ms with the assertion unchanged.

Grepping for the same pattern afterwards found two more instances in `lib/` — both fixed
in the same sweep (`lib/jalali.ts` 10x, `lib/orderJourney.ts` 67x).

Two rules follow, and both are cheap:

1. **Before filing a test as a flake, run it ALONE more than once.** One run proves
   nothing about a coin flip. "Passes alone" needs to be a repeatable observation.
2. **A test that is borderline on its own is not contention — it is too slow.** Compare its
   idle time against the 5000ms budget. Under ~50% it is contention. Near or over it is a
   defect, and raising a timeout hides it rather than removing it.

The tell is *how* a test is slow. Wasted setup (building the same object 7,672 times) is a
bug. Intrinsic work (a 9,576-cell geometry sweep) is just a slow test, and is fine.

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
