# Persian Copy Audit — Hand-written Summary

**Generated from:** `docs/copy-audit/catalogue.md` (296 strings, 86 flagged)

---

## 1. Stale Surfaces (delete / confirm)

| Route | Status | Evidence | Recommendation |
|-------|--------|----------|----------------|
| `/analytics` | STALE-SURFACE | `tests/appNav.test.ts` asserts it's retired; `proxy.ts:115` still gates it; `PAGE_META` has an entry | **Delete** — nothing links to it |
| `/sales/analysis` | STALE-SURFACE | Same; `PAGE_META` has entry with title «تحلیل» | **Delete** |
| `/sales/admin/representatives` | STALE-SURFACE | Redirect stub pointing to `/sales/reps`; `PAGE_META` has its own title | **Keep as redirect**, tighten `PAGE_META` overview to say so plainly |

---

## 2. ZWNJ Inconsistencies (2 stems)

The corpus shows two Persian stems appearing both with and without ZWNJ (Zero-Width Non-Joiner `‌`):

| Stem | Appears as | Example files |
|------|------------|---------------|
| `مکان` | `مکان` (no ZWNJ) + `مکان‌ها` (with ZWNJ) | `lib/pageMeta.ts`, `/facilities`, `/leads`, `/planner`, `/sales/*` |
| `شنبه` | `شنبه` (no ZWNJ) + `شنبه‌ها` / `شنبه` with ZWNJ in compounds | `/planner`, `/sales/forecast` |

**Recommendation:** Pick one style per stem. The app's existing `lib/orderStateMachine.ts` and `lib/pageMeta.ts` use ZWNJ for `برنامهٔ` etc. — standardise on **with ZWNJ for compounds** (`مکان‌ها`, `شنبه‌ها`), **without for bare nouns** (`مکان`, `شنبه`). Run a bulk find-replace.

---

## 3. Arabic Character Offenders (4 files)

| File | Arabic chars found | Fix |
|------|-------------------|-----|
| `lib/repo/search.ts` | `ي`, `ك`, `ى` | Use Persian `ی`, `ک`, `ی` |
| `lib/persian.ts` | `ي`, `ك` | This is the normalizer — it should convert Arabic → Persian |
| `components/SearchBox.tsx` | `ي`, `ك` | Use Persian |
| `components/sales/OrderForm.tsx` | `ي`, `ك` | Use Persian |

**Recommendation:** The `lib/persian.ts` normalizer (`faDigits`, `normalisePersian`) should be imported and used in these files rather than hardcoding Persian.

---

## 4. Other Flags

| Flag | Count | Notes |
|------|-------|-------|
| RETIRED-WORD | 0 | None found — the `vocabulary.test.ts` guard is working |
| RAW-ENUM | 0 | None found — the `no-raw-enum-copy.test.ts` guard is working |
| UNLABELLED-ENUM | 0 | None found |

---

## 5. What the Script Cannot Judge

The generator flags mechanically detectable issues only. The following require a human ear:

| Screen | Candidate strings | Question |
|--------|-------------------|----------|
| `/sales/today` | «به‌روزرسانی کارها» vs «به‌روزرسانیِ کارها» | ZWNJ on compound |
| `/sales/stock` | «روز گذشته» vs «روزِ گذشته» | ZWNJ on compound |
| `/sales/commission` | All Persian labels | Verify natural phrasing for salespeople |
| `/planner` | Days of week labels | Consistency with rest of app |

**Action:** Review these screens in-browser and adjust strings where they read unnaturally. The script has done the mechanical filtering; the rest is editorial.

---

## Next Steps (out of scope for this audit)

1. **Fix ZWNJ inconsistency** — bulk replace `مکان‌ها`/`شنبه‌ها` consistently
2. **Remove stale pages** — after your approval: delete `/analytics` and `/sales/analysis`, tighten `/sales/admin/representatives`
3. **Arabic → Persian normalisation** — run `lib/persian.ts` normalizer on the 4 offender files
4. **Nav per-role personalization** — separate spec (the nav labels themselves are clean; the variation is visibility only)