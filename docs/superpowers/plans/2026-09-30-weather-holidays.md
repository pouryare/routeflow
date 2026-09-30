# Weather on the Calendar and Iranian Public Holidays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a weather icon and a holiday marker on every day cell of the `/sales/schedule` month grid, and give owners a way to record Iranian public holidays — including the lunar ones no seed can know.

**Architecture:** Two independent mechanisms that meet only on the calendar. Weather already exists end to end: `lib/weather/openMeteo.ts` fetches, `lib/weather/conditions.ts` classifies a reading into six `ConditionCode`s, and `weather_snapshots` stores it keyed by `(lat_r, lng_r, forecast_date)`. None of it reaches a calendar cell. Holidays are entirely new — there is no table, no module and no seed anywhere in the repo.

**The two are deliberately decoupled.** A holiday must never affect routing, and a failed forecast API must never break the calendar. Neither reads the other.

---

## The finding that shapes the holiday half

Iran runs **three calendars** (verified against Wikipedia): Solar Hijri for the national calendar, Gregorian for international events, and **Lunar Hijri for Islamic holidays**. That splits the seed in two:

| Kind | Examples | How |
|---|---|---|
| **Solar Hijri — fixed in the Jalali calendar** | Nowruz 1–4 Farvardin · 12 Farvardin (روز جمهوری اسلامی) · Sizdah Bedar 13 Farvardin · Khordad 14 · Khordad 15 · Bahman 22 · Esfand 29 | **Generated** from `lib/jalali.ts` — deterministic, no seeding needed |
| **Lunar Hijri — shift every Gregorian year** | Eid al-Fitr (۱ شوال) · Eid al-Adha (۱۰ ذی‌الحجه) · Tasua (۹ محرم) · Ashura (۱۰ محرم) · Mawlid (۱۷ ربیع‌الاول) | **Owner-confirmed rows.** No offline seed can know these — they depend on moon sighting |

So `lib/holidays.ts` generates the solar ones and the table stores the lunar ones. Iran has ~28 public holidays plus unofficial extended-weekend days, which is why a holiday row carries a **`kind`** column and not a boolean.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/holidays.ts` | **New, pure.** The solar-Hijri fixed list, generated per Jalali year. No DB import — testable without a database. |
| `lib/repo/holidays.ts` | **New.** Reads/writes the `holidays` table; merges generated + stored rows for a Jalali month. |
| `lib/db.ts` | **Modify.** One `holidays` table. Shared reference data, like `districts` — **no `organization_id`**. |
| `scripts/seed-holidays.mjs` | **New.** Writes the solar rows for a year range. Idempotent. |
| `lib/weather/calendarForecast.ts` | **New, pure.** `forecastForMonth(snapshots)` → `Record<isoDate, ConditionCode[]>`. Separates "what does this month look like" from "how do I fetch it". |
| `app/(shell)/sales/schedule/page.tsx` | **Modify.** Compute `weatherMarks` and `holidayMarks` beside the existing `marks`. |
| `components/meridian/ScheduleBoard.tsx` | **Modify.** Accept and render the two new mark sets. |
| `components/meridian/icon-map.ts` | **Modify.** Add weather glyphs if the six conditions need their own. |
| `tests/holidays.test.ts` | **New.** Generation, boundaries, lunar storage. |
| `tests/calendar-weather.test.ts` | **New.** Month projection from snapshots. |

**Where the weather lives in the cell.** `ScheduleBoard` already renders a `marks` prop as `Record<dayNumber, string[]>` of dot colours, sliced to 3. Weather and holiday do **not** go in there — a fifth dot is unreadable. They get a dedicated glyph row in the cell, because a weather icon and a holiday flag are *named*, and a colour dot is not.

---
### Task 1: The solar-Hijri holiday generator, as a pure module

The fixed-in-Jalali holidays, generated rather than seeded. Pure — no database, no `lib/db` import — so it is testable in milliseconds and cannot fail at boot.

**Files:**
- Create: `lib/holidays.ts`
- Test: `tests/holidays.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/holidays.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toJalali } from "@/lib/jalali";
import { SOLAR_HOLIDAYS, holidaysForJalaliYear } from "@/lib/holidays";

/** What the generator must get right.
 *
 *  These are computed rather than seeded because a Jalali year and a Gregorian year are
 *  different lengths: a hard-coded ISO date drifts by a day every four years and is wrong
 *  at every leap boundary. The generated ISO must agree with `toJalali`, the app's own
 *  authority, on ordinary AND leap years. */

describe("the fixed-in-Jalali holidays", () => {
  it("knows a fixed set of holiday dates", () => {
    expect(SOLAR_HOLIDAYS.length).toBeGreaterThanOrEqual(10);
  });

  it("puts Nowruz on 1 Farvardin and Sizdah Bedar on 13 Farvardin", () => {
    expect(SOLAR_HOLIDAYS.find((h) => h.title_fa === "نوروز")).toMatchObject({ jm: 1, jd: 1 });
    expect(SOLAR_HOLIDAYS.find((h) => h.title_fa === "سیزده بدر")).toMatchObject({ jm: 1, jd: 13 });
  });

  it("marks 22 Bahman as the anniversary of the revolution", () => {
    expect(SOLAR_HOLIDAYS).toContainEqual(
      expect.objectContaining({ jm: 11, jd: 22, title_fa: "پیروزی انقلاب اسلامی" }),
    );
  });

  it("distinguishes commemorative days from days the office closes", () => {
    expect(SOLAR_HOLIDAYS.filter((h) => h.kind === "commemorative").length).toBeGreaterThan(0);
  });

  it("round-trips every holiday through the app's own Jalali conversion", () => {
    for (const h of holidaysForJalaliYear(1405)) {
      expect(h.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(toJalali(h.iso)).toMatchObject({ jy: 1405, jm: h.jm, jd: h.jd });
    }
  });

  it("agrees on a LEAP year too — 1403 is a Jalali leap year", () => {
    for (const h of holidaysForJalaliYear(1403)) {
      expect(toJalali(h.iso)).toMatchObject({ jy: 1403, jm: h.jm, jd: h.jd });
    }
  });

  it("returns them in calendar order", () => {
    const list = holidaysForJalaliYear(1405);
    expect(list.map((h) => h.iso)).toEqual(
      [...list].sort((a, b) => a.iso.localeCompare(b.iso)).map((h) => h.iso),
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holidays.test.ts
```

Expected: FAIL — "no such module `lib/holidays`".

---
- [ ] **Step 3: Write the module**

Create `lib/holidays.ts`. Note the import: this module deliberately depends on `lib/jalali.ts` (for the conversion) and on **nothing else** — no `lib/db`, which is why a wrong date here cannot take the app down at boot.

```ts
import { jalaliToIsoDate } from "./jalali";

/** The fixed-in-the-Jalali-calendar public holidays of Iran.
 *
 *  These are the ones no seed has to know: each is a (month, day) pair in the Solar Hijri
 *  calendar, so the ISO date is a pure function of the Jalali year and `lib/jalali.ts`
 *  already converts it correctly, leap years included.
 *
 *  The LUNAR holidays (Eid al-Fitr, Eid al-Adha, Tasua, Ashura, Mawlid) are NOT here and
 *  cannot be. Iran runs three calendars: Solar Hijri for the national one, Gregorian for
 *  international events, and Lunar Hijri for Islamic holidays. A lunar date moves against
 *  the Gregorian one every year and is set by moon sighting, so no offline computation can
 *  know it — those live in the database and an owner confirms them each year. That split
 *  is the whole reason this module exists rather than one table of everything. */

export interface Holiday {
  /** ISO `YYYY-MM-DD`, the form every date in this database is stored as. */
  iso: string;
  jy: number;
  jm: number;
  jd: number;
  title_fa: string;
  /** `official` closes the office; `commemorative` is observed but the office is open —
   *  12 Farvardin, Khordad 15 and Esfand 29 are all commemorative in Iran. */
  kind: "official" | "commemorative";
}

export interface SolarHolidaySeed {
  jm: number;
  jd: number;
  title_fa: string;
  kind: Holiday["kind"];
}

export const SOLAR_HOLIDAYS: readonly SolarHolidaySeed[] = [
  { jm: 1, jd: 1, title_fa: "نوروز", kind: "official" },
  { jm: 1, jd: 2, title_fa: "عید نوروز", kind: "official" },
  { jm: 1, jd: 3, title_fa: "عید نوروز", kind: "official" },
  { jm: 1, jd: 4, title_fa: "عید نوروز", kind: "official" },
  { jm: 1, jd: 12, title_fa: "روز جمهوری اسلامی", kind: "commemorative" },
  { jm: 1, jd: 13, title_fa: "سیزده بدر", kind: "official" },
  { jm: 3, jd: 14, title_fa: "رحلت امام خمینی", kind: "commemorative" },
  { jm: 3, jd: 15, title_fa: "قیام ۱۵ خرداد", kind: "commemorative" },
  { jm: 11, jd: 22, title_fa: "پیروزی انقلاب اسلامی", kind: "official" },
  { jm: 12, jd: 29, title_fa: "ملی شدن صنعت نفت", kind: "commemorative" },
];

/** Every fixed holiday in one Jalali year, in calendar order.
 *
 *  Year-scoped rather than month-scoped so a caller can build a whole-year map once; the
 *  month filter belongs to the calendar's caller, not to this list. */
export function holidaysForJalaliYear(jy: number): Holiday[] {
  return SOLAR_HOLIDAYS.map((h) => ({
    iso: jalaliToIsoDate(jy, h.jm, h.jd),
    jy,
    jm: h.jm,
    jd: h.jd,
    title_fa: h.title_fa,
    kind: h.kind,
  })).sort((a, b) => a.iso.localeCompare(b.iso));
}

/** The holidays that fall inside one Jalali month. */
export function holidaysForJalaliMonth(jy: number, jm: number): Holiday[] {
  return holidaysForJalaliYear(jy).filter((h) => h.jm === jm);
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holidays.test.ts
```

Expected: **7/7 pass.** If the leap-year case fails, `jalaliToIsoDate` is the authority and this list is wrong — fix the list, never the test.

- [ ] **Step 5: Commit**

```bash
### Task 2: The `holidays` table, for the lunar ones

`lib/db.ts` creates every table in one `db.exec(...)`. Add it there. **No `organization_id`** — a national holiday is identical in every tenant, exactly the reasoning that took `districts` out of `TENANT_TABLES`.

**Files:**
- Modify: `lib/db.ts`
- Create: `lib/repo/holidays.ts`
- Test: `tests/holidays.test.ts` (append)

- [ ] **Step 1: Append the failing repo test**

`tests/holidays.test.ts` currently has no database. Add the standard tmp-db preamble at the **top** of the file, above every existing import:

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `holidays-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;

const { getDb } = await import("@/lib/db");
const { upsertHoliday, deleteHoliday, listHolidaysForMonth } = await import(
  "@/lib/repo/holidays"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});
```

Add `import { holidaysForJalaliMonth } from "@/lib/holidays";` to the imports too — the merge tests need it to find a generated row to override.

- [ ] **Step 2: Append the test cases**

Append:

```ts
const LUNAR = "2026-03-20"; // Eid al-Fitr in 2026 — a date no computation can know

describe("the holidays table (the lunar ones)", () => {
  it("stores an owner-confirmed lunar holiday", () => {
    upsertHoliday({ iso: LUNAR, title_fa: "عید فطر", kind: "official", lunar: true });
    expect(listHolidaysForMonth(2026, 1).find((h) => h.iso === LUNAR)).toMatchObject({
      title_fa: "عید فطر",
      kind: "official",
    });
  });

  it("is idempotent — the same date twice is one row, last write wins", () => {
    upsertHoliday({ iso: LUNAR, title_fa: "عید فطر", kind: "official", lunar: true });
    upsertHoliday({ iso: LUNAR, title_fa: "عید فطر (اصلاح)", kind: "official", lunar: true });
    const rows = listHolidaysForMonth(2026, 1).filter((h) => h.iso === LUNAR);
    expect(rows).toHaveLength(1);
    expect(rows[0].title_fa).toBe("عید فطر (اصلاح)");
  });

  it("merges the generated solar holidays in without them ever being seeded", () => {
    const month = listHolidaysForMonth(1405, 1);
    expect(month.filter((h) => h.title_fa.includes("نوروز")).length).toBeGreaterThanOrEqual(1);
    for (const h of month) {
      expect(h.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.title_fa.length).toBeGreaterThan(0);
    }
  });

  it("an owner row wins over a generated one on the same date", () => {
    const generated = holidaysForJalaliMonth(1405, 1).find((h) => h.jd === 12)!;
    upsertHoliday({
      iso: generated.iso,
      title_fa: "روز جمهوری اسلامی (تعطیل رسمی)",
      kind: "official",
      lunar: false,
    });
    const merged = listHolidaysForMonth(1405, 1).find((h) => h.iso === generated.iso);
    expect(merged?.title_fa).toBe("روز جمهوری اسلامی (تعطیل رسمی)");
    expect(merged?.kind).toBe("official");
  });

  it("deleting an override restores the generated row, not an empty day", () => {
    const generated = holidaysForJalaliMonth(1405, 1).find((h) => h.jd === 13)!;
    upsertHoliday({ iso: generated.iso, title_fa: "موقتی", kind: "official", lunar: false });
    deleteHoliday(generated.iso);
    expect(listHolidaysForMonth(1405, 1).find((h) => h.iso === generated.iso)?.title_fa).toBe(
      "سیزده بدر",
    );
  });

  it("deleting a LUNAR row really removes it — nothing generates it back", () => {
    upsertHoliday({ iso: LUNAR, title_fa: "عید فطر", kind: "official", lunar: true });
    deleteHoliday(LUNAR);
    expect(listHolidaysForMonth(2026, 1).find((h) => h.iso === LUNAR)).toBeUndefined();
  });

  it("has no organization_id — a national holiday is the same in every tenant", () => {
    const cols = (getDb().prepare("PRAGMA table_info(holidays)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).not.toContain("organization_id");
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holidays.test.ts
```

Expected: FAIL — "no such table: holidays".

- [ ] **Step 4: Add the table**

In `lib/db.ts`, inside the `db.exec(...)` that creates the schema, add:

```sql
    /* Iranian public holidays that CANNOT be computed.
     *
     *  The Solar Hijri fixed ones (Nowruz, Sizdah Bedar, Bahman 22, …) are generated by
     *  `lib/holidays.ts` and are deliberately NOT stored: they are a pure function of the
     *  Jalali year, so a stored copy is a second source of truth that goes stale the moment
     *  one date is wrong.
     *
     *  This table holds only what a computer cannot know. Iran runs three calendars, and its
     *  Islamic holidays are Lunar Hijri — Eid al-Fitr, Eid al-Adha, Tasua, Ashura, Mawlid.
     *  Those move against the Gregorian calendar every year and are set by moon sighting, so
     *  an owner records them once a year. That is not a workaround; it is how every Iranian
     *  HR system does it.
     *
     *  No organization_id, for the same reason `districts` has none: a national holiday is
     *  the same in every tenant on this server, and a scope column that is always NULL
     *  invites a filter that empties a calendar. */
    CREATE TABLE IF NOT EXISTS holidays (
      iso_date TEXT PRIMARY KEY,
      title_fa TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'official'
        CHECK (kind IN ('official', 'commemorative')),
      /* True for a row an owner entered — i.e. one `lib/holidays.ts` cannot compute. Kept
         * for the admin screen's "these need confirming each year" hint. */
      is_lunar INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );
```

- [ ] **Step 5: Write the repo module**

Create `lib/repo/holidays.ts`:

```ts
/** Reading and writing the holidays a computer cannot compute.
 *
 *  The merge rule is the important part. `lib/holidays.ts` GENERATES the Solar Hijri fixed
 *  holidays; this table holds the Lunar Hijri ones an owner confirms each year. On the
 *  same date, **the stored row wins** — the algorithm knows Nowruz is 1 Farvardin, but it
 *  does not know whether this particular office works that day, and the owner does.
 *
 *  That makes DELETE mean "stop overriding" rather than "erase the holiday": a deleted
 *  override falls back to the generated row. Only a date with no generated counterpart
 *  (every lunar one) actually disappears, which is the behaviour Task 2's tests pin. */

import { getDb } from "@/lib/db";
import { holidaysForJalaliMonth, type Holiday } from "@/lib/holidays";
import { jalaliMonthLength, jalaliToIsoDate } from "@/lib/jalali";

export interface StoredHoliday {
  iso: string;
  title_fa: string;
  kind: "official" | "commemorative";
  is_lunar: number;
}

export function upsertHoliday(input: {
  iso: string;
  title_fa: string;
  kind?: "official" | "commemorative";
  lunar?: boolean;
  note?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO holidays (iso_date, title_fa, kind, is_lunar, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (iso_date) DO UPDATE SET
         title_fa = excluded.title_fa,
         kind     = excluded.kind,
         is_lunar = excluded.is_lunar,
         note     = excluded.note`,
    )
    .run(
      input.iso,
      input.title_fa,
      input.kind ?? "official",
      input.lunar ? 1 : 0,
      input.note ?? null,
      new Date().toISOString(),
    );
}

export function deleteHoliday(iso: string): void {
  getDb().prepare("DELETE FROM holidays WHERE iso_date = ?").run(iso);
}

function storedInMonth(jy: number, jm: number): Map<string, StoredHoliday> {
  const from = jalaliToIsoDate(jy, jm, 1).slice(0, 10);
  const last = jalaliMonthLength(jy, jm);
  const toExcl = new Date(Date.parse(jalaliToIsoDate(jy, jm, last)) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = getDb()
    .prepare("SELECT * FROM holidays WHERE iso_date >= ? AND iso_date < ?")
    .all(from, toExcl) as unknown as Array<{
    iso_date: string;
    title_fa: string;
    kind: "official" | "commemorative";
    is_lunar: number;
  }>;
  return new Map(rows.map((r) => [r.iso_date, { iso: r.iso_date, ...r } as StoredHoliday]));
}

/** One month, generated solar holidays merged with the stored lunar ones. */
export function listHolidaysForMonth(jy: number, jm: number): Holiday[] {
  const stored = storedInMonth(jy, jm);
  const out: Holiday[] = holidaysForJalaliMonth(jy, jm).map((h) => {
    const s = stored.get(h.iso);
    return s
      ? { iso: h.iso, jy: h.jy, jm: h.jm, jd: h.jd, title_fa: s.title_fa, kind: s.kind }
      : h;
  });
  // A stored row on a date nothing generated is a lunar holiday — the whole point of the
  // table — so it joins the list rather than being deduplicated away.
  for (const s of stored.values()) {
    if (!out.some((h) => h.iso === s.iso)) {
      out.push({ iso: s.iso, jy: 0, jm: 0, jd: 0, title_fa: s.title_fa, kind: s.kind });
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}
```

- [ ] **Step 6: Run and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holidays.test.ts
```

Expected: **14/14 pass** (7 from Task 1, 7 new).

- [ ] **Step 7: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 8: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/db.ts lib/repo/holidays.ts tests/holidays.test.ts
git commit -m "feat(holidays): a table for the dates no algorithm can know"
```

---

### Task 3: Month weather, as a pure projection

`weather_snapshots` already stores a reading per `(lat_r, lng_r, forecast_date)`, and `conditionsFor` already classifies one into six `ConditionCode`s. Neither reaches a calendar. This task adds the projection, pure, so it can be tested with no network and no database.

**Files:**
- Create: `lib/weather/calendarForecast.ts`
- Test: `tests/calendar-weather.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/calendar-weather.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { conditionsFor } from "@/lib/weather/conditions";
import { monthConditions, dayIcon, CONDITION_ICON } from "@/lib/weather/calendarForecast";

const row = (
  forecast_date: string,
  o: Partial<Parameters<typeof conditionsFor>[0]> = {},
) => ({
  forecast_date,
  temp_min: null, temp_max: null, precip_prob: null, precip_mm: null, snow_mm: null,
  wind_kmh: null, gust_kmh: null, visibility_m: null, weather_code: null,
  ...o,
});

describe("month weather for the calendar", () => {
  it("returns an empty map for no snapshots rather than throwing", () => {
    expect(monthConditions([])).toEqual({});
  });

  it("classifies a heavy-rain day", () => {
    expect(monthConditions([row("2026-10-01", { precip_mm: 12 })])["2026-10-01"]).toContain(
      "heavy_rain",
    );
  });

  it("keys by the snapshot's OWN forecast_date, never by array order", () => {
    const m = monthConditions([
      row("2026-10-09", { precip_mm: 12 }),
      row("2026-10-02", { snow_mm: 3 }),
    ]);
    expect(m["2026-10-09"]).toContain("heavy_rain");
    expect(m["2026-10-02"]).toContain("snow_ice");
  });

  it("a calm day maps to an empty array, not to a missing key", () => {
    // The cell must know it was CONSIDERED and found clear; an absent key would render
    // identically to "we never fetched", which is a different statement.
    expect(monthConditions([row("2026-10-03")])["2026-10-03"]).toEqual([]);
  });

  it("composes several conditions on one day rather than picking one", () => {
    expect(
      monthConditions([row("2026-10-04", { precip_mm: 12, temp_max: 38 })])["2026-10-04"],
    ).toEqual(expect.arrayContaining(["heavy_rain", "extreme_heat"]));
  });

  it("ignores a row with no usable date instead of writing a key of undefined", () => {
    expect(Object.keys(monthConditions([row("2026-10-05"), row("")]))).toEqual(["2026-10-05"]);
  });

  it("every condition code has an icon, so no cell can render a blank", () => {
    for (const code of ["heavy_rain", "snow_ice", "extreme_heat", "high_wind", "dust_storm", "fog"] as const) {
      expect(CONDITION_ICON[code], `no icon for ${code}`).toBeTruthy();
    }
  });

  it("picks the worst condition's icon when a day has several", () => {
    expect(dayIcon(["heavy_rain", "extreme_heat"])).toBe(CONDITION_ICON.extreme_heat);
  });

  it("an empty condition list has no icon", () => {
    expect(dayIcon([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Write the module**

Create `lib/weather/calendarForecast.ts`:

```ts
import { conditionsFor, type ConditionCode, type WeatherReading } from "./conditions";
import type { IconName } from "@/components/meridian/icon-map";

/** A month of weather reduced to what a calendar cell can actually show.
 *
 *  The forecast is already fetched, classified and stored by `lib/weather/` — it has just
 *  never reached a calendar. This is the projection that connects them, kept pure so it can
 *  be tested with no network and no database: a snapshot row in, an icon per day out.
 *
 *  The one behaviour worth stating is that a CALM day maps to an empty array rather than to
 *  a missing key. Those are not the same fact: "we looked and it is clear" and "we never
 *  fetched" must not render identically, or a failed forecast would look like good weather. */

export interface ForecastRow extends WeatherReading {
  forecast_date: string;
}

/** Worst condition first — the order the cell picks its icon in. A day that is both wet and
 *  38°C shows the heat, because heat is what stops the van running, not the rain. */
const SEVERITY: readonly ConditionCode[] = [
  "extreme_heat",
  "dust_storm",
  "snow_ice",
  "high_wind",
  "heavy_rain",
  "fog",
];

/** Every condition maps to an icon that already exists in `ICONS`. A missing name here is a
 *  type error, not a blank cell at runtime — which is the point of typing it as IconName. */
export const CONDITION_ICON: Record<ConditionCode, IconName> = {
  heavy_rain: "fog",
  snow_ice: "mountain",
  extreme_heat: "sun",
  high_wind: "radar",
  dust_storm: "fog",
  fog: "fog",
};

/** `Record<isoDate, ConditionCode[]>` for a whole month. A row without a usable
 *  `forecast_date` is skipped rather than written under an `undefined` key. */
export function monthConditions(rows: readonly ForecastRow[]): Record<string, ConditionCode[]> {
  const out: Record<string, ConditionCode[]> = {};
  for (const r of rows) {
    if (typeof r.forecast_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.forecast_date)) {
      continue;
    }
    out[r.forecast_date] = conditionsFor(r);
  }
  return out;
}

/** The one glyph a cell shows for a day, or `null` when the day is clear. */
export function dayIcon(conditions: readonly ConditionCode[]): IconName | null {
  for (const code of SEVERITY) {
    if (conditions.includes(code)) return CONDITION_ICON[code];
  }
  return null;
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/calendar-weather.test.ts
```

Expected: **9/9 pass.** If `CONDITION_ICON` names an icon absent from `icon-map.ts`, `tsc` says so — add the name to `ICONS` in Step 5 of this task, or reuse an existing one.

- [ ] **Step 5: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```
### Task 4: Render both on the schedule grid

`ScheduleBoard` already takes `marks: Record<number, string[]>` of dot colours, sliced to 3. **Neither new mark goes in there** — a fifth dot is unreadable, and a weather icon is *named*, not a colour. Each gets a dedicated glyph row inside the cell.

**Files:**
- Modify: `app/(shell)/sales/schedule/page.tsx`
- Modify: `components/meridian/ScheduleBoard.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Read the two files' relevant parts**

```bash
cd /home/pourya/Desktop/routeflow
sed -n '230,255p' 'app/(shell)/sales/schedule/page.tsx'
sed -n '84,100p' components/meridian/ScheduleBoard.tsx
```

- [ ] **Step 2: Compute both maps in the page**

In `app/(shell)/sales/schedule/page.tsx`, beside the existing `marks` block, add:

```ts
  /* Weather and holidays for the month grid.
   *
   *  Both are keyed by ISO date and projected to `Record<jd, …>` because the grid's unit is
   *  the day-of-month, and neither may be able to break the page: a missing forecast yields
   *  an empty map, and holidays are generated in-process with no I/O at all. The two are
   *  independent — a holiday never touches routing, and the forecast never touches a plan. */
  const weatherIso = monthConditions(
    getDb()
      .prepare(
        `SELECT forecast_date, temp_min, temp_max, precip_prob, precip_mm, snow_mm,
                wind_kmh, gust_kmh, visibility_m, weather_code
           FROM weather_snapshots
          WHERE forecast_date BETWEEN ? AND ?`,
      )
      .all(
        jalaliToIsoDate(jy, jm, 1).slice(0, 10),
        jalaliToIsoDate(jy, jm, jalaliMonthLength(jy, jm)).slice(0, 10),
      ) as ForecastRow[],
  );
  const weatherMarks: Record<number, IconName | null> = {};
  for (let d = 1; d <= days; d++) {
    weatherMarks[d] = dayIcon(weatherIso[jalaliToIsoDate(jy, jm, d)] ?? []);
  }

  const holidaysByDay = new Map(listHolidaysForMonth(jy, jm).map((h) => [h.jd, h]));
```

Add the imports:

```ts
import { monthConditions, dayIcon, type ForecastRow } from "@/lib/weather/calendarForecast";
import { listHolidaysForMonth } from "@/lib/repo/holidays";
import { jalaliMonthLength, jalaliToIsoDate } from "@/lib/jalali";
import type { IconName } from "@/components/meridian/icon-map";
```

Drop `jalaliToIsoDate` / `jalaliMonthLength` from any existing import if the file already had them.

- [ ] **Step 3: Pass both to the board**

On the existing `<ScheduleBoard … />`, add:

```tsx
        weather={weatherMarks}
        holidays={holidaysByDay}
```

- [ ] **Step 4: Accept the props in the component**

In `components/meridian/ScheduleBoard.tsx`, extend the props type:

```ts
  /** Day-of-month → the one weather glyph, or null for a clear day. */
  weather: Record<number, IconName | null>;
  /** Day-of-month → the holiday, when that day is one. */
  holidays: Map<number, { title_fa: string; kind: "official" | "commemorative" }>;
```

Destructure `weather` and `holidays` alongside the existing props, and add
`import type { IconName } from "./icon-map";` if it is not already imported.

- [ ] **Step 5: Render the glyph row inside each day cell**

Inside the day-cell `<button>`, after `<span>{faNum(d)}</span>` and before the dots:

```tsx
                <span className="calflags">
                  {holidays.get(d) ? (
                    <span
                      className={`calflag calflag--${holidays.get(d)!.kind}`}
                      title={holidays.get(d)!.title_fa}
                      aria-label={`تعطیل: ${holidays.get(d)!.title_fa}`}
                    />
                  ) : null}
                  {weather[d] ? <Icon name={weather[d]!} size="sm" label="" /> : null}
                </span>
```

The holiday marker is `aria-labelled`, not colour-only: MASTER.md bans colour as the only
signal, and a red dot a screen reader cannot describe is exactly that.

- [ ] **Step 6: Style the flags**

In `app/globals.css`, beside the other `.cal` rules:

```css
/* Weather and holiday marks inside a day cell.
 *
 *  Deliberately NOT extra dots in `.dots`: that row is a colour list sliced to three, and a
 *  fifth dot is unreadable at phone size. A separate flag row keeps a holiday identifiable
 *  even when the weather glyph is absent. */
.calflags {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 12px;
  line-height: 0;
}
.calflag {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--crit);
}
/* A commemorative day (12 Farvardin, Khordad 15) is observed but the office is open, so it
 * is a ring rather than a solid: the SHAPE carries the difference, not only the colour. */
.calflag--commemorative {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--muted);
}
```

- [ ] **Step 7: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 8: Run the calendar and page suites**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/day-tabs.test.ts tests/holidays.test.ts tests/calendar-weather.test.ts tests/pageMeta.test.ts 2>&1 | tail -20
```

Expected: all pass. `tests/day-tabs.test.ts` is the suite that owns this grid.

- [ ] **Step 9: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add 'app/(shell)/sales/schedule/page.tsx' components/meridian/ScheduleBoard.tsx app/globals.css
git commit -m "feat(schedule): a weather glyph and a holiday flag on every day cell"
```

---

### Task 5: The owner screen for the lunar holidays

Without this the table is write-only and every Eid needs a database edit.

**Files:**
- Create: `app/api/admin/holidays/route.ts` (GET, POST)
- Create: `app/api/admin/holidays/[iso]/route.ts` (DELETE)
- Create: `app/(shell)/sales/admin/holidays/page.tsx`
- Modify: `lib/pageMeta.ts`

- [ ] **Step 1: Write the failing API test**

Create `tests/holiday-admin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `holiday-admin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { createSessionToken } = await import("@/lib/auth");

let owner = 0;
let manager = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const org = Number(
    db.prepare("INSERT INTO organizations (name) VALUES ('H')").run().lastInsertRowid,
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,organization_id,created_at) VALUES (?,?,?,?,?,?)",
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "مالک", "owner", org, now).lastInsertRowid);
  manager = Number(u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", org, now).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const post = (token: string, body: unknown) =>
  new NextRequest("http://localhost/api/admin/holidays", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `rf_session=${token}` },
    body: JSON.stringify(body),
  });

describe("the holiday admin API", () => {
  it("an owner records a lunar holiday", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const token = await createSessionToken({ userId: owner, role: "owner" } as never);
    const res = await POST(post(token, { iso: "2026-03-20", title_fa: "عید فطر", kind: "official" }));
    expect(res.status).toBe(200);
  });

  it("a NON-owner is refused", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const token = await createSessionToken({ userId: manager, role: "group_manager" } as never);
    expect((await POST(post(token, { iso: "2026-03-21", title_fa: "x" }))).status).toBe(403);
  });

  it("refuses a blank title and a date that is not a real ISO date", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const token = await createSessionToken({ userId: owner, role: "owner" } as never);
    for (const bad of [
      { iso: "2026-03-20", title_fa: "   " },
      { iso: "20-03-2026", title_fa: "x" },
      { iso: "2026-13-01", title_fa: "x" },
    ]) {
      expect((await POST(post(token, bad))).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("GET returns the stored rows", async () => {
    const { GET } = await import("@/app/api/admin/holidays/route");
    const token = await createSessionToken({ userId: owner, role: "owner" } as never);
    const res = await GET(
      new NextRequest("http://localhost/api/admin/holidays", {
        headers: { cookie: `rf_session=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { holidays: unknown[] };
    expect(Array.isArray(json.holidays)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holiday-admin.test.ts
```

Expected: FAIL — "no such module `app/api/admin/holidays/route`".

- [ ] **Step 3: Write the routes**

Create `app/api/admin/holidays/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { getDb } from "@/lib/db";
import { upsertHoliday } from "@/lib/repo/holidays";

/** Owner-only, like every other administrative write here.
 *
 *  A holiday is not per-tenant — the table has no organization_id, see `lib/db.ts` — but
 *  RECORDING one is an owner act. The lunar dates are lunar, so somebody has to confirm the
 *  sighting each year, and that somebody should not be whoever is driving. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const rows = getDb().prepare("SELECT * FROM holidays ORDER BY iso_date").all();
  return NextResponse.json({ ok: true, holidays: rows });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const iso = typeof body?.iso === "string" ? body.iso.trim() : "";
  const title = typeof body?.title_fa === "string" ? body.title_fa.trim() : "";
  const kind = body?.kind === "commemorative" ? "commemorative" : "official";

  // Shape AND validity: "2026-13-01" matches the pattern and is not a date.
  const probe = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  if (!probe || Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) {
    return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "عنوان الزامی است" }, { status: 400 });
  }

  upsertHoliday({ iso, title_fa: title, kind, lunar: true });
  return NextResponse.json({ ok: true });
}
```

Create `app/api/admin/holidays/[iso]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { deleteHoliday } from "@/lib/repo/holidays";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/holidays/[iso]">) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { iso } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
  }
  deleteHoliday(iso);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holiday-admin.test.ts
```

Expected: **4/4 pass.**

- [ ] **Step 5: Write the page**

Create `app/(shell)/sales/admin/holidays/page.tsx`, modelled on
`app/(shell)/sales/admin/users/page.tsx`: `"use client"`, `useRunAfterMount`, a `fetch` on
mount, a table.

It needs three things:

1. One Persian paragraph above the table explaining **why the lunar ones are typed by hand**.
   An owner who does not know this will read the page as broken when Nowruz appears by itself
   and Eid does not.
2. A form: date via `components/meridian/JalaliDateInput` (never `<input type="date">` —
   `tests/no-gregorian-dates.test.ts` bans the browser picker), a title, and an
   official/commemorative toggle.
3. The stored rows, each with a delete button.

Wire create to `POST /api/admin/holidays`, delete to `DELETE /api/admin/holidays/<iso>`.

Add to `lib/pageMeta.ts`, in the same style as its neighbours:

```ts
  "/sales/admin/holidays": {
    title: "تعطیلات",
    overview:
      "روزهای تعطیلی که تقویم شمسی آن‌ها را نمی‌تواند حساب کرد: عید فطر، عید قربان، تاسوعا، عاشور و میلاد. هر سال پس از اعلام رسمی، تاریخ را اینجا ثبت کنید؛ نوروز و سیزده بدر خودکار نمایش داده می‌شوند.",
  },
```

- [ ] **Step 6: Type check and run the guards**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit && npx vitest run tests/pageMeta.test.ts tests/no-gregorian-dates.test.ts tests/section-headings.test.ts
```

Expected: **0 errors** and all pass. `tests/pageMeta.test.ts` walks `app/(shell)` and fails on any route with no entry, so the new page must appear in `PAGE_META`.

- [ ] **Step 7: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add app/api/admin/holidays 'app/(shell)/sales/admin/holidays' lib/pageMeta.ts tests/holiday-admin.test.ts
git commit -m "feat(admin): an owner screen for the lunar holidays"
```

---

### Task 6: Verify the whole plan

**Files:** none — verification only.

- [ ] **Step 1: Run every suite this plan touched**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/holidays.test.ts tests/calendar-weather.test.ts tests/holiday-admin.test.ts tests/day-tabs.test.ts
```

Expected: **all pass.**

- [ ] **Step 2: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 3: Prove the two mechanisms are decoupled**

```bash
cd /home/pourya/Desktop/routeflow
grep -rn "holidays" lib/routing lib/weather 2>/dev/null | wc -l
```

Expected: **0.** A holiday must never reach route capacity or a delivery plan.

- [ ] **Step 4: Run the full suite (backgrounded — ~14 min)**

```bash
cd /home/pourya/Desktop/routeflow
setsid nohup npx vitest run > /tmp/vitest-weather.log 2>&1 &
tail -20 /tmp/vitest-weather.log
```

Expected: `2 failed / 2735 passed` is a **PASS** when the two are `tests/jalali.test.ts` ("agrees with Intl for every day across 20 Jalali years") and `tests/api/routing-route.test.ts` ("plans, commits and freezes"). Re-run any other failure alone first:

```bash
npx vitest run tests/<the-failing-file>
```

---

## Verification Summary

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit                              # 0 errors
npx vitest run tests/holidays.test.ts          # 14/14
npx vitest run tests/calendar-weather.test.ts  # 9/9
npx vitest run tests/holiday-admin.test.ts     # 4/4
git status --short                             # clean
```

The calendar shows a weather glyph and a holiday flag per day; the fixed holidays are computed
and the lunar ones owner-entered, and neither can affect routing.

## Notes for the Engineer

- **`toJalali` is the authority on dates.** If a holiday test disagrees with it, the holiday list is wrong — never edit `lib/jalali.ts` to make a test pass. It is the one module with a dedicated 19-case suite.
- **Never run `next build`** here. Use `npx tsc --noEmit` and `npx vitest run`.
- **`sharp` stays at exactly `0.33.5`** (`--save-exact`); this CPU has no AVX2.
- **Two suites flake under full-suite load** (`tests/jalali.test.ts`, `tests/api/routing-route.test.ts`). Both pass alone.
