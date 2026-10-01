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