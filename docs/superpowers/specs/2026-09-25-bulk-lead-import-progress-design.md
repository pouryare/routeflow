# Bulk Lead Import — Live Decode Progress Design

**Date:** 2026-09-25
**Status:** Draft (pending user review)
**Scope:** `components/LeadImportPanel.tsx`, `app/api/locations/parse/`, new `lib/leadImport/`, new `components/leadImport/`, new tables in `lib/db.ts`

---

## Problem

`/leads` has an «افزودن از لینک» box. A user pastes a chunk of chat export or a list of
Google/Neshan/Balad maps links, presses «تجزیه», and the panel shows «در حال تجزیه…» until
one HTTP request finishes. Then every item appears at once, already resolved.

Three problems, in order of severity:

1. **The request cannot survive its own duration.** `POST /api/locations/parse` parses and
   then fully resolves every link before returning a single byte. Resolution is a four-step
   cascade (`lib/resolveMapsLink.ts`): direct lat/lng in the URL (~300ms), Plus Code
   (~300ms), a real Chromium page via Playwright (up to 12s), and finally a Nominatim text
   search that is **globally throttled to ~1 request/second** by a shared module-level gate
   in accordance with Nominatim's usage policy. A 1000-link paste therefore runs for
   minutes and will hit proxy or server timeouts — the user gets nothing, and the work is
   lost.

2. **No progress, and the progress would be a lie anyway.** Even if the request survived,
   the current fire-all-at-once model gives every item equal visual weight, so a link
   resolved in 300ms is indistinguishable from one grinding through a browser for 12s.
   Users who cannot see why something is slow invent workarounds — splitting pastes to
   produce two spinners instead of one, which helps nobody.

3. **The happy path costs clicks.** After decoding, the user is shown a full review list
   with checkboxes and must click «افزودن N مورد به فهرست» even when every item decoded
   perfectly and none is a duplicate.

### Honest timing

Derived from the constants in the code (8s fetch timeout, 12s Playwright timeout, 1.1s
global Nominatim gate, concurrency 4), assuming the *worst* case where every link needs
the slowest tier:

| Batch | Typical mix | Worst case |
|---|---|---|
| 20 links | ~8s | ~25s |
| 100 links | ~35-50s | ~90s |
| 1000 links | ~4-6 min | ~10-15 min |

Per 1000 links: tier 1 ≈ 35s, tier 2 ≈ 3min, tier 3 ≈ 2min. **Tier 3 is a hard floor** —
Nominatim's 1 req/sec cap cannot be optimised without risking an IP ban, so it is a tax,
not a defect. 1000 links will take minutes. This is why the progress display must be
truthful: the alternative is an opaque spinner for ten minutes.

---

## Goals

- A 1000-link paste never times out, never loses completed work, and survives refresh.
- The user always knows **what method** is being tried, **how many** items need it, and
  roughly **how long** is left.
- Decoding is enjoyable to watch, and the delight comes from the progress being honest
  rather than from decoration.
- The happy path ends in **zero clicks**.
- Anything that needs a human is collected in one place and never auto-added.

## Non-goals

- Cancel-and-resume mid-item. Cancel stops the queue; the in-flight item finishes.
- More than one decode job at a time (see *Concurrency*, below).
- CSV export of the problem list. It stays copyable text.
- Per-item retry for individual failures. A whole job can be re-pasted.
- Any change to how a single link is resolved. `resolveMapsLink` is untouched.

---

## Architecture

### The core move: a request becomes a job

`POST /api/locations/parse` now performs only the **instant** work — parse links and
dedupe identical URLs — and returns a job in tens of milliseconds. Decoding *and*
duplicate detection run in a detached async runner that persists each result the moment it
lands. The client polls.

```
LeadImportPanel (client)
  │  POST /api/locations/parse { text }        → { jobId, total, items[] }   fast
  │  GET  /api/locations/parse/[jobId]  (1s)   → { job, items[] }
  │  POST /api/locations/parse/[jobId]/cancel  → { }
  ▼
lib/leadImport/runner.ts   (module singleton, detached, never awaited by the request)
  │  tier scheduler → lib/resolveMapsLink.ts (unchanged)
  │  per-item persist → lib/repo/leadImport.ts
  ▼
SQLite: lead_import_jobs, lead_import_items
```

Polling rather than SSE: the codebase has no SSE anywhere, but `NotificationBell` and
`lib/offline/syncEngine.ts` both poll, so this matches existing practice. A dropped poll
simply misses a frame; there is no reconnection protocol to get wrong.

### Why the work is already server-side

`resolveMapsLinks` fetches, geocodes and drives Chromium entirely on the server. The
browser tab is only ever an observer. That is what makes the "survives everything" version
nearly free: once per-item results are persisted, refresh-survival, navigation-survival
and background-continuation all fall out of the same mechanism rather than being three
separate features.

### Data model

Two new tables in `lib/db.ts`, both tenant-scoped, both accessed through
`lib/repo/leadImport.ts` via `makeRepo` — which satisfies `tests/repo-boundary.test.ts`
without an allowlist entry, and `tests/tenancy-schema.test.ts` once both names are added to
the `TENANT_TABLES` list.

**`lead_import_jobs`**

| Column | Notes |
|---|---|
| `id` | PK |
| `organization_id` | tenant scope, required |
| `group_id` | the target list, from the session's group filter |
| `status` | `running` \| `done` \| `cancelled` |
| `stage` | `parse` \| `fast` \| `browser` \| `nominatim` \| `finish` |
| `total`, `done_count`, `unresolved_count`, `duplicate_count` | denormalised counters so the status poll is one cheap row read |
| `notified_at` | set once when the 60s notification fires; guards against three open tabs notifying three times |
| `created_at`, `finished_at` | |

**`lead_import_items`**

| Column | Notes |
|---|---|
| `id` | PK |
| `organization_id`, `job_id` | tenant scope + parent |
| `ordinal` | position in the paste; drives stable row order |
| `name`, `maps_url` | from `parsePastedChat` |
| `lat`, `lng`, `address`, `resolved_url`, `resolution` | from `resolveMapsLink` |
| `status` | `pending` \| `resolving` \| `done` \| `unresolved` \| `duplicate` \| `skipped` |
| `duplicate_of` | `location` \| `customer` \| `batch` |
| `saved_location_id` | set when auto-added; makes undo a single scoped delete |
| `batch_tag` | stamped on every `saved_locations` row this run creates, so the batch stays identifiable after the job row is pruned |

The `resolution` CHECK constraint reuses the existing `LocationResolution` union, which
already includes `"browser"`.

### The tier scheduler

The runner does not use a flat queue. Before each pickup it re-sorts the pending set so
that anything still satisfiable by `direct` or `pluscode` is always chosen before anything
requiring a browser or Nominatim. Tier 1 therefore drains completely and quickly, then
tier 2 trickles, then tier 3 crawls.

This is the mechanism that makes the progress bar's *shape* truthful: it accelerates while
easy links fly and visibly slows when the browser and the 1/sec gate take over. The
scheduler is a **pure function** — `(pending) => nextIndex` — so it is unit-testable with
no network and no timers.

**Concurrency:** one active job at a time, deliberately. Two concurrent 1000-link jobs
would contend for the same global Nominatim budget, making both slower, and the throttle
gate in `resolveMapsLink.ts` is already a shared module-level queue. A second paste is
**queued**, and the panel says «یک پردازش در جریان است — نوبت شما بعد از آن».

**Restart recovery:** on boot, jobs left `running` with no live worker are requeued and
resume from `pending` items. Already-resolved items are not resolved twice.

### Duplicate detection moves into the runner

The existing route detects batch-internal duplicates with an **O(n²) loop** calling
Jaro-Winkler on every pair (`app/api/locations/parse/route.ts`), plus a
`findDuplicateSignal` pass against every saved location and customer per item. At 1000
items that is ~500,000 Persian-string comparisons — seconds, not milliseconds — which is
exactly why it cannot stay in the request.

Instead, each item is duplicate-checked **as it resolves**, using the existing
`lib/duplicateDetection.ts` helpers unchanged (`jaroWinkler`, `findDuplicateSignal`,
`findBatchDuplicates`) against: a `DuplicatePool` loaded once per job, and the items already
resolved in this batch. This is both faster (O(n) against a bounded pool per item) and more
correct, since by then the item has real coordinates to compare rather than only a name.

### Auto-add

When the queue empties, items with `resolution` in `direct | pluscode | browser`, non-null
coordinates, and no duplicate signal are inserted into `saved_locations` with the batch tag
and their `saved_location_id` recorded. Duplicate and unresolved items are not inserted.

The user is then left with exactly two things: a one-line summary, and the problem list.

---

## The progress UI

Three layers. The panel stops being a textarea and becomes a live console.

### Layer 1 — headline

A progress bar plus one live sentence that names the **current method** and the **count
still needing it**, so "why is this slow" is never a mystery:

> «۶۲ از ۱۰۰۰ — مرورگر باز می‌کند (۱۲ مورد)»

Below the bar, an ETA recalculated from **observed** tier throughput rather than a fixed
guess. It is deliberately allowed to stretch: «~۴ دقیقه» early on, honestly growing to
«~۹ دقیقه» when the slow tail arrives. Never reports `۰:۰۰` while items remain.

### Layer 2 — live list

Rows appear **in paste order immediately** — parsed items are known before any decoding
begins — as grey placeholders, then transition in place as each result lands:

```
●  تالار پذیرایی نهاجا          ▸ در حال خواندن لینک        ⟳
●  رستوران گلستان              ✓ مختصات دقیق                 35.7219, 51.3347
●  کافه لیان                   ✓ مختصات دقیق                 35.7442, 51.4018
●  فروشگاه پارس                ⏳ نیاز به مرورگر — ۱۲ ثانیه   ۰:۰۹
●  داروخانه دکتر شیدا           ⏳ جستجوی نشانی               ·
```

Because rows are created up front and never re-sorted, **the list never reflows** — no
scroll-jumping while the user is watching. Only the visible window renders; the rest are
counted, not drawn.

### Layer 3 — map backdrop

Each resolved pin drops onto the existing `CoverageMap` as it lands. Pending items render
as faint hollow dots, so the *shape of what remains* is visible: a scattered cloud, then a
trickle, then a handful of stragglers. 1000 static markers are handled by
`react-leaflet-cluster`, already a dependency. The drop ring is `pointer-events: none`.

### The finish

The bar reaches 100%, the list collapses — a height transition, not a jump — to a single
line:

> **۸۴ مکان اضافه شد** · ۱۶ نیاز به بررسی دارد · `[بازگرداندن]`

Undo lives ~10 seconds, then fades. Auto-add without any way to back out is a hard thing to
trust; a timed undo removes the fear without reintroducing a review step. It is a scoped
delete over the rows whose `saved_location_id` this job recorded — it cannot touch
anything else.

Problem cases stay live in a compact separate list: name, address text, a
«نیاز به مکان‌یابی» badge, and their batch tag, so nothing becomes an orphan. They are
resolved later by hand from the map, as today.

### Slow-job notification

If a job is still running at **60 seconds**, one bell notification is inserted. Silent
below that threshold — otherwise every ordinary paste makes noise and the notification
stops meaning anything. In-app bell only; the existing notification table, prefs and
`lib/repo/notifications.ts` are reused unchanged.

---

## Craft

The app has a real design system, and a feature that ignores it looks like a bolt-on.
Every colour below is a token; **no hex value is hardcoded anywhere in the new code.**

**The accent follows the user's theme.** `lib/accent.ts` lets the user pick an accent, with
generated palettes under `[data-accent]`. The bar fill, the pin-drop ripple and the
shimmer all read `var(--accent)`, so the whole feature matches whatever they chose.

Three deliberate signatures:

1. **The bar is not a bar.** A 4px track, `--radius-sm` fill, and a 1px `--accent` leading
   highlight at 60% opacity running ahead of the fill edge. It reads as motion rather than
   as a percentage, and it is what keeps the bar feeling alive at 40% during a quiet patch.
   The fill transitions on `--dur-morph` (0.42s, `EASE.out`) so it glides between jumps.

2. **The shimmer does honest work.** Slow-tier rows get a left-to-right sweep whose speed
   is *inversely proportional to how long they have waited*: a link 2s into its Playwright
   attempt shimmers briskly, one at 11s of a 12s timeout shimmers almost imperceptibly and
   turns `--warn` at 10s. The animation is a countdown you can feel. `EASE.snap`, short
   loop.

3. **The pin drop has weight.** `EASE.pop` (the overshoot curve) — a 180ms scale-and-settle
   plus one expanding ring fading on `--dur-slow`. At 4-6 drops per second it stays legible
   because the ring never captures pointer events.

**Typography and rhythm.** Row status text is `--text-xs` in `--text-faint` while pending,
promoting to `--text` when resolved, so the list brightens as it fills. Numbers go through
`faNum()` so `۱٬۰۰۰` never renders as `1000`. Status badges reuse the existing
`Icon`/`IconName` set and `StatusPill` rather than introducing new chrome.

**Motion discipline.** Every animation is expressed in the existing `lib/motion.ts` tokens
(`DUR`, `EASE`, `STAGGER`) or their CSS equivalents in `app/globals.css`, and every one is
gated on `lib/usePrefersReducedMotion.ts`: under `prefers-reduced-motion` the entrance
becomes an immediate paint, the shimmer stops, pins simply appear.

**Where beauty is deliberately not spent.** No confetti, no fake percentages, no easing
that lies about speed. On a 6-minute job the bar moves slowly, and that is correct.

### Pre-existing bugs fixed in passing

Two, both in the blast radius of this feature:

1. **Missing `browser` badge.** `LeadImportPanel`'s `RESOLUTION_META` record has no
   `browser` key, though `LocationResolution` permits `"browser"` and `resolveMapsLink`
   returns it — so a Playwright-resolved link currently throws on `rm.icon`. Adding the
   badge *is* the fix; the bug and the feature are the same line of code.

2. **`alreadySaved` is a placeholder.** `app/api/locations/parse/route.ts` computes it as
   `!!filter.sql` — the truthiness of the tenant filter *string*, not whether the URL is
   already in `saved_locations`. It is wrong today. Auto-add would build directly on it, so
   it is replaced with a real lookup against the loaded pool (which the row is already in).

---


---


## Error handling

Failure is a state, not an exception. `resolveMapsLink` already never throws — a bad link
returns `resolution: "unresolved"` — which is exactly the property a 1000-item batch
needs, and that contract is preserved.

| Failure | Behaviour |
|---|---|
| Redirect loop, disallowed host, non-map URL | `unresolved` with whatever address text exists → problem list; run continues |
| Playwright throws, or Chromium unavailable | Item falls through to Nominatim. If no browser can be launched at all, the runner logs one line and skips the browser tier for the entire run rather than timing out 400 times |
| Nominatim 429 or outage | Item → `unresolved`; the runner backs off globally and the panel shows «سرویس نشانی موقتاً کند است». The budget is shared, so backing off protects the rest of the batch |
| Server restarts mid-run | On boot, `running` jobs with no live worker are requeued and resume from `pending` |
| Tab closed or navigated away | Nothing. The job continues; results are already persisted |
| Second paste while one runs | Queued, with «یک پردازش در جریان است — نوبت شما بعد از آن» |
| User cancels | In-flight item finishes, nothing further starts, job marked `cancelled`, partial results kept and offered |
| Duplicate against existing leads | Detected **before** auto-add using the same Jaro-Winkler + coordinate-pool logic as today; excluded from the insert; shown as a problem case with «لینک با موجودی» |
| A paste containing no map links | `422` from the parse step, exactly as today, before any job is created |

---

## Testing

`vitest`, in the existing `tests/` directory.

- **`runner.test.ts`** — tier ordering: given a mixed pending set, the pure scheduler picks
  every `direct`/`pluscode` item before any `browser` item, and never before a `pluscode`
  item that a `direct` would satisfy. Asserts counters never exceed `total`. No network, no
  timers — the scheduler is pure.
- **`jobLifecycle.test.ts`** — `running → done` / `→ cancelled` transitions, restart requeue
  of an orphaned job, and the 60s `notified_at` guard firing exactly once.
- **`eta.test.ts`** — the ETA function against fixed observed-throughput fixtures: it grows
  when the slow tail arrives, and never returns `۰:۰۰` with items outstanding.
- **`pasteImport.test.ts`** (existing, extended) — a 1000-link paste yields items in order
  and dedupes repeated URLs. `parsePastedChat` is pure string work with no similarity calls,
  so it stays fast; the assertion is that the *parse* step alone completes well inside a
  second, which is what keeps the request responsive.
- **`duplicateDetection.test.ts`** (new) — per-item duplicate checks against the job's
  `DuplicatePool` and against already-resolved batch items, using the existing helpers
  unchanged. Guards the claim that moving dedupe into the runner did not change which items
  are flagged.
- **`autoAdd.test.ts`** — clean items land with the batch tag; duplicates and unresolved do
  not; undo within the window removes exactly that job's rows and nothing else.
- **`LeadImportPanel.test.tsx`** — with a mocked poll: progress advances, rows transition
  in place, the list collapses at 100%, undo appears then expires.
- **`/leads` smoke test** — happy path guarded end to end, per the existing smoke config.

---

## Files

**New**

- `lib/leadImport/scheduler.ts` — pure tier-ordering function
- `lib/leadImport/runner.ts` — module singleton, detached loop, restart requeue, per-item dedupe, auto-add
- `lib/leadImport/eta.ts` — pure throughput → ETA
- `lib/repo/leadImport.ts` — `makeRepo` tables plus the hand-written aggregate reads
- `components/leadImport/ProgressBar.tsx`, `LiveItemList.tsx`, `DecodeConsole.tsx`, `ProblemList.tsx`
- `app/api/locations/parse/[jobId]/route.ts`, `.../cancel/route.ts`

**Changed**

- `lib/db.ts` — two `CREATE TABLE IF NOT EXISTS` blocks, both names in `TENANT_TABLES`
- `app/api/locations/parse/route.ts` — shrinks to parse + create-job; the O(n²) dedupe loop and
  the resolution call move into the runner
- `components/LeadImportPanel.tsx` — becomes the console; gains the missing `browser` badge
- `lib/repo/notifications.ts` — one new call site, no interface change

**Untouched:** `lib/resolveMapsLink.ts`, `lib/geoLinks.ts`, `lib/pasteImport.ts`,
`lib/playwrightExtract.ts`. The resolution cascade is the thing being made *visible*, not
rewritten.

