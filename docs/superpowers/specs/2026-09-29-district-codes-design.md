# District Codes — منطقه / محله numbering (design)

Date: 2026-09-29 · Status: approved in brainstorming (4 sections reviewed one by one) ·
Origin: a shared ChatGPT thread proposing a ZIP-like customer code, challenged against
this codebase before anything was written.

## 0. What this is, and what it is not

A short, stable, speakable **code per district** (`منطقه` / `محله` / `بخش` / outer town),
so a rep can disambiguate two places with the same name, and a printed route sheet can
be ordered geographically.

**Not a customer identifier.** `customers.customer_code` stays `CRM-…` / `LEAD-…`. The
thread's own strongest recommendation was to keep the geographic code and the customer
identity separate; routeflow already did that in September and keeps doing it.

**Not a new hierarchy of tables.** No `provinces`, no `cities`, no `zip_codes`. A number
that identifies a district is a column, not a schema to maintain.

## 1. Why this was scoped down before it was scoped up

The originating request was a four-level code — `11-05-003` for province 1, county 1,
bakhsh 5, mahalle 3 — generated per customer, with a lead-numbering strategy designed
from scratch.

Routeflow already answers most of it:

| The thread recommended | Routeflow has |
|---|---|
| "OPTION D — one unified entity" for leads vs customers | A lead is a `customers` row with `lifecycle='lead'`; `saved_locations` retired (spec D2, 2026-09-11) |
| separate `customer_id` / `location_id` / `location_code` | `customers.id` / `customers.district_id` / `districts.code` |
| "business territory layer above official geography" | `districts.group_id` → `groups` → `canReachGroup()` |
| a hierarchy of province/city tables | `districts` with `level`, `parent_name`, `is_custom` |

Its "generate the code from typed location fields" advice is also **worse** than what
exists: `lib/repo/crm/write.ts:73` derives `district_id` from `lat`/`lng` by
point-in-ring, so a rep drops a pin and the geography is computed, never typed.

Two findings reshaped the work:

1. **`districts` had 0 rows.** Fully designed, completely empty. Every customer had
   `district_id = NULL`. All the geometry sat on disk unseeded.
2. **The number's only real job is disambiguation.** A rep says *پردیس*, not

## 2. Data foundation

### 2.1 The missing file, found

`scripts/seed-districts.ts:59` reads
`data/tehran-districts-src/districts.json` — the 22 `منطقه` polygons. **That path does
not exist**, so the script dies with `ENOENT` at line 59, before it can load the 369
`محله` either. This is the reason `districts` is empty. Not a decision — a missing file.

Source, confirmed compatible:

- `mjalalimanesh/tehran-districts-neighborhoods-map-geojson` →
  `tehran_districts_22.geojson` (from `map.tehran.ir`)
- `sadegh-khan/tehran-map-geojson` → `tehran-areas-22-polygon.geojson`
  (**md5-identical**: `67ba2362ff1c7228bc2ce8f1dd927372`)
- `rferdosi/tehran-districts` → 22 features, but ASCII names and no geometry quality. Not used.

**Compatibility measured against our own data:** of the 369 `محله` in
`data/mahalle.geojson`, **367 fall inside one of these 22 polygons**. The 2 that do not
are `شهرک رضویه` (منطقه 15) and `شهید بهشتی` (منطقه 20), both just outside the outline.

### 2.2 Digits: the second time names have bitten this data

```
source names : منطقه ۱۴ شهر تهران     ← Persian digits (۱۴ = 14)
our file     : منطقه 1                 ← ASCII digits
```

`UNIQUE(name, level, parent_name)` is the join key, so this mismatch would silently
produce `محله` rows whose parent does not exist.

**Decision — add `parent_no INTEGER`.** Digits become an integer; Persian/ASCII can never
mismatch again. Display stays `منطقه 14`. `lib/persian.ts` already has the conversion.
Verified: parses for **22 of 22**, no duplicate numbers.

### 2.3 Bug: outer towns get the wrong parent county

`scripts/seed-outer-towns.ts:11-14` defaults every town to `شهرستان دماوند`. Checked
each centroid against the `بخش` polygons:

| Town | Falls in | Script assigns | |
|---|---|---|---|
| بومهن | بخش بومهن — شهرستان ری | شهرستان دماوند | ❌ |
| آبعلی | **بخش رودهن** — شهرستان ری | شهرستان دماوند | ❌ |
| رودهن | بخش رودهن — شهرستان ری | شهرستان دماوند | ❌ |
| پردیس | بخش مرکزی پردیس | شهرستان پردیس | ✅ |
| دماوند / آبسرد / کیلان | بخش مرکزی دماوند | شهرستان دماوند | ✅ |

The original request also named **هراز** and **گیلاوند**; neither is in
`outer-towns.json` (7 towns). Out of scope for this spec — the 7 are what we have data
for. Anything without a polygon stays `NULL` and is reported.

### 2.4 Seed order

Each is `INSERT OR IGNORE` and safe to re-run; order matters because the codes come last.

```
1. scripts/seed-districts.ts   → 22 منطقه + 369 محله
2. scripts/seed-bakhsh.ts      → 34 بخش
3. scripts/seed-outer-towns.ts → 7 towns  (with the §2.3 fix)

## 3. The code scheme

```sql
-- guarded ALTER TABLE ADD COLUMN, matching the CUSTOMER_COLUMNS pattern in
-- lib/repo/crm/migrate.ts:95 (declared) and :112 (applied, after a PRAGMA table_info
-- membership check so an existing column is never re-added)
ALTER TABLE districts ADD COLUMN code TEXT;
ALTER TABLE districts ADD COLUMN parent_no INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS ix_districts_code ON districts(code) WHERE code IS NOT NULL;
```

Partial-unique because `is_custom = 1` districts and split halves have no code until
one is assigned. A hard `UNIQUE` would fail the moment two customs are left blank.

### 3.1 The rules

| Kind | Rule | Example |
|---|---|---|
| `منطقه` | Tehran's own number | `منطقه 14` → `14` |
| `محله` | parent + 2-digit west→east ordinal | `1401` … `1426` |
| `بخش` | county letter + `B` + index | `RB1` = ری |
| outer town | letter + index | `P1` = پردیس, `B1` = بومهن, `R1` = رودهن |

`districts.level` is CHECK-constrained to `mantaghe | mahalle`, so both `بخش` and towns
are `mantaghe` rows. The prefix is keyed off `parent_name`: `شهرستان …` → county scope,
`بخش …` → bakhsh scope.

**Outer towns get letters because digits would collide.** Tehran's `منطقه` are already
`1`–`22`. Numbering پردیس `1` would collide with `منطقه 1` in one namespace — the exact
confusion the code exists to prevent.

### 3.2 Why the ordinal is geographic, not alphabetical

The first proposal was `parent + alphabetical ordinal`. It parsed cleanly and had zero
collisions, and it was wrong:

```
منطقه 14 | alphabetical order == west-to-east order?  2/25
منطقه  5 | alphabetical order == west-to-east order?  0/27
```

Sorting `501, 502, 503…` walks across the city in Persian-alphabet jumps — آپادانا,
ارم, اکباتان are nowhere near each other. A code that looks like it encodes order but
doesn't is worse than no code, because a rep trusts it and drives an hour for nothing.

**So the ordinal is west→east**, per the decision that matches پردیس/رودهن being east of
the city. Verified: 0 collisions across all 356 distinct `محله`; 3–4 digits, all numeric.

This also means **a `محله` code survives its rename** — the code came from where the
polygon *is*. Under a split, the main body keeps its row and code, and the new piece
takes the next ordinal, invalidating neither half's printed sheet.

### 3.3 The case for having codes at all


## 4. Backfill, search, route sheet

### 4.1 Backfill

| Target | Rows | Coordinates | Mechanism |
|---|---|---|---|
| `customers` | 16 | 14 | `districtIdForPoint` |
| `saved_locations` (pins) | 25 | 25 | `districtIdForPoint` |
| `lead_list_items` | 76 | via pin | join through |

All 25 pins already resolve — every one lands inside پردیس.

It calls the **same function the app uses on write** (`lib/groups.ts:48`), so a backfilled
value is bit-identical to what a new lead would get. No second implementation to drift.

Rows without coordinates (`LEAD-12`, `LEAD-14`) stay `NULL` and are reported. A pin with
no location has no district, and guessing one is worse than an empty field.

This is a `scripts/` script with a dry-run default — **not** a boot migration, because
`tests/no-one-shot-data-migration.test.ts` forbids a row-dependent predicate behind an
`app_meta` marker.

### 4.2 Search

`lib/searchModel.ts` already runs input through `normalisePersian`, so `۱۴`, `14` and
`١٤` collapse together. Two additions:

- `SearchKind` gains `"district"`; selecting a hit flies to it on the coverage map, like
  a customer hit does via `MAP_FOCUS_EVENT`.
- Code lookup is a **prefix** match — `code LIKE '14%'`. Substring would let `1` return
  `منطقه 1` plus all 26 of `1401`–`1426` for one keystroke.

### 4.3 Route sheet

Group stops by district, order groups by `code` (west→east), order stops within a group
by `nearestNeighborOrder`, print each header as `۱۴۰۵`. The rep reads top to bottom and
drives west to east.

`lib/geo.ts` already provides `nearestNeighborOrder` and `routeLengthKm`. The sheet must
not print an ETA — `routeLengthKm`'s own comment says it is "a comparison tool, never a
promise about driving time."

## 5. Error handling

| Failure | Behaviour |
|---|---|
| `districts.json` absent at seed time | Throw with a named message; write nothing. A 22-without-369 seed leaves `parent_name` pointing at rows that don't exist |
| Source feature has no `name` | Skip, count, report |
| `planSplit` returns multiple pieces | Each gets its own code; largest keeps the plain name and the original row (existing behaviour) |
| Two districts compute the same code | **Abort.** Impossible by construction, so a collision means malformed geometry |
| A `محله` falls outside all 22 outlines | Coded under its **declared** parent, `is_custom=1`, reported |
| Customer has no `lat`/`lng` | `district_id` stays `NULL`, listed in the report |
| Pin moves | `setLocation` re-derives it — already the case, which is why codes are not on the customer |
| Boundary redrawn | `district_id` re-derived on next write; the **code does not change** |

## 6. Testing

Modelled on `tests/districtSplit.test.ts` (pure logic), `tests/crm-schema.test.ts`
(schema), `tests/no-one-shot-data-migration.test.ts` (the marker rule).

**`tests/districtCodes.test.ts`** — assignment is pure and deterministic
- every `منطقه 1..22` gets its own number
- two `محله` in one `منطقه` get different ordinals
- **zero collisions** across all seeded rows
- **idempotent: a second run assigns nothing new** ← the stability guarantee
- west→east: lowest code has the lowest longitude
- Persian and ASCII digits in a parent name parse to the same `parent_no`

**`tests/districts-seed.test.ts`** — the seed reaches the shapes it claims
- 22 `منطقه` and ≥369 `محله`
- **the file it reads exists** (the bug that emptied this table cannot return)
- every `محله.parent_name` resolves to a real `منطقه` row
- a re-run changes no existing row

**`tests/outer-towns-parent.test.ts`** — bug §2.3 cannot come back
- بومهن, آبعلی, رودهن → شهرستان ری
- پردیس → شهرستان پردیس
- every town centroid falls inside its declared parent's `بخش`

**`tests/district-code-search.test.ts`** — the prefix rule
- `14` ranks `منطقه 14` first
- `14` does not flood the first page with every `14xx`
- `۱۴` finds the same rows as `14`

**`tests/no-one-shot-data-migration.test.ts`** — extended, not replaced
- assert `lib/db.ts` gained no new marker read, so the guarantee is pinned

## 7. Out of scope

- **هراز / گیلاوند** — named in the original ask, absent from `outer-towns.json`. Needs
  its own OSM `admin_level=7` extraction, like a separate change.
- **A new `location_code` on `customers`** — deliberately rejected. Two sources that can
  disagree the moment a customer moves is the bug the origin thread warned about.
- **A rep-facing "speak a code to the app" input.** The code is printed and searchable;
  nobody has to memorise it.

## 8. Open question this cannot answer in code

Whether a rep finds `۱۴۰۵` useful in the van. Kept cheap to be wrong about: a nullable
column and three display sites, so dropping it means not rendering it, with no data to
unwind.

**13 names collide inside their own `منطقه`:**

```
شهرک نفت → منطقه 5 (×2)     کوهسار → منطقه 4 (×2)
صادقیه    → منطقه 18 (×2)    جوادیه → منطقه 16 (×2)
پونک جنوبی → منطقه 5 (×2)    قیام   → منطقه 14 (×2)
... 13 total
```

`UNIQUE(name, level, parent_name)` forces these into one MultiPolygon, which is wrong —
`کوهسار` is drawn 21km apart. `planSplit` splits them into near-identical names. That is
precisely when a rep needs a number: *کوهسار 4* vs *کوهسار 4 east*.

### 3.4 What a code is not

It is not typed by a rep, anywhere. Not in Add Lead, not in search-as-input-except-code,
not required to save. The name is the interface; the code is the tiebreaker and the
print artifact. It appears in exactly three places:

| Where | Shows |
|---|---|
| Coverage map legend | `منطقه 14` with `۱۴` as a badge |
| Customer card / detail | `منطقه 14 · محله ۱۴۰۵`, dimmed secondary line |
| Printed route sheet | `۱۴۰۵ — جابری` per stop |

4. scripts/assign-district-codes.ts → codes, deterministic, WHERE code IS NULL
5. scripts/split-districts.ts --apply  → repairs same-name-different-place
6. scripts/backfill-districts.ts --apply → district_id on customers + pins
```

**Step 4 is separate from step 1 on purpose.** If codes were assigned during the seed, a
re-seed after a split would renumber existing districts and every printed route sheet
would silently point somewhere else. `WHERE code IS NULL` makes step 4 idempotent.

   *P-one*. A code that duplicates a name the rep already speaks is noise.
