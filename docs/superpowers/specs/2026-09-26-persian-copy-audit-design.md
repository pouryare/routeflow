# Persian Copy Audit — Design

**Scope:** on-screen UI Persian copy only. No DB seed, API JSON, print/Excel output, test fixtures.

**Deliverables:**
- `scripts/audit-copy.mjs` — re-runnable extractor + 7 detectors
- `docs/copy-audit/catalogue.md` — generated catalogue of all on-screen strings + status flags
- `docs/copy-audit/summary.md` — hand-written judgement
- `tests/copyAudit.test.ts` — guards the generator

**In scope:**
- One word per concept, enforced by test
- `RETIRED-WORD` detector (reuses `vocabulary.test.ts` banned words)
- `RAW-ENUM` detector (reuses `no-raw-enum-copy.test.ts` bare-interpolation)
- `ARABIC-CHARS` detector
- `ZWNJ-INCONSISTENT` detector — catches `لغوشده` ↔ `لغو'hydro` (both present in 3 files)
- `STALE-SURFACE` detector — surfaces 3 pages already contradicting own tests
- `UNLABELLED-ENUM` detector
- `OK` for everything else

**Out of scope:**
- Nav per-role personalization (separate follow-up)
- DB seed, API JSON, print/Excel output
- Deleting pages without your OK

**Approach:** generator walks routes → .tsx + imported label maps → extract Persian literals → apply detectors → emit catalogue.md + summary.md. The generator is build-guarded: re-running it must produce a byte-identical catalogue, so hand-edits fail.

**Known hazard:** `lib/repo/notifications.ts` is binary-sized (38 KB); generator reads UTF-8 explicitly, never uses shell grep.

**Honest limit:** script cannot judge a translation as "wrong"; that lives in the hand-written summary.

---
Generated: 2026-09-26