/** How a district gets its short code, as pure functions.
 *
 *  Separate from the seed script because none of this touches a database: it is naming
 *  and geometry, so it can be tested directly (tests/districtCodes.test.ts) the way
 *  lib/districtSplit.ts is. The same split as lib/searchModel.ts, whose comment says why:
 *  the module decides, the script does.
 *
 *  A code exists to disambiguate two places that share a name, not to encode the hierarchy.
 *  A rep says «پردیس», not "P-one" -- so the name is the interface and the code is the
 *  tiebreaker and the print artifact. Thirteen محله names collide inside their own منطقه
 *  (کوهسار is drawn 21km apart), and that is the case where a number earns its keep. */

// The .ts extension is deliberate and is the only one in lib/. scripts/ runs under
// `node --experimental-strip-types`, which cannot resolve an extensionless relative import
// (ERR_MODULE_NOT_FOUND) -- the same thing that made all three seed scripts unrunnable
// until they were repointed at SQLite directly. scripts/*.ts already import lib modules
// this way, and tsconfig sets allowImportingTsExtensions, so this costs nothing and keeps
// the rules testable AND runnable from scripts/assign-district-codes.ts.
import { normalisePersian } from "./persian.ts";

/** The number inside a منطقه's name, whichever digits it is written in.
 *
 *  This is the whole reason the schema carries `parent_no INTEGER` rather than joining the
 *  369 محله to their 22 منطقه on `parent_name`: the two source files spell the same
 *  district differently -- map.tehran.ir writes "منطقه ۱۴ شهر تهران" and our own
 *  mahalle.geojson writes "منطقه 14" -- and an integer cannot be spelled two ways.
 *
 *  normalisePersian does the digit folding, and is deliberately lossy: it also lowercases
 *  and strips zero-width joiners. Both are harmless here, and reusing it beats a second
 *  Persian-digit table that would be one more thing to keep in step. */
export function parentNoFromName(name: string): number | null {
  const m = normalisePersian(name).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

/** The whole code for each seeded outer town.
 *
 *  Six entries, and this is a deliberate exception rather than a hole in the rule: a town's
 *  code cannot be derived from anything, because the town has no number and its name has no
 *  stable position. Deriving one from scan order would be the bug this mapping exists to
 *  prevent -- بومهن would be B1 or B2 depending on which row the query returned first, and a
 *  code that moves is worse than no code.
 *
 *  `آبعلی` is absent on purpose: its polygon sits inside بخش رودهن, so the بخش layer already
 *  covers it (spec §2.4) and giving it a third code would be a second answer to "where is
 *  آبعلی". A town added later with no code here falls back to X<index>, and the seed reports
 *  every fallback rather than letting two towns collide silently. */
const TOWN_CODE: Record<string, string> = {
  پردیس: "T1", بومهن: "T2", رودهن: "T3", دماوند: "T4", آبسرد: "T5", کیلان: "T6",
};

/** A منطقه's own code.
 *
 *  Tehran's 22 districts are already numbered, so the code IS that number: a rep says
 *  «منطقه 14» out loud and it is unambiguous, which is the only property that matters for a
 *  code someone has to relay by voice.
 *
 *  Outer towns and بخش have no number, and giving them digits would collide with
 *  منطقه 1..22 in one namespace -- the exact confusion a code exists to prevent. So they
 *  take a letter. A town takes its own initial (پردیس -> P1); a بخش takes a county
 *  letter plus "B" (بخش رودهن, in ری -> RB1), because a bare letter would let a بخش and a
 *  town that share a first letter take the same code. */
export function codeForMantaghe(parentNo: number | null, name: string, index = 1): string {
  if (parentNo !== null) return String(parentNo);
  const clean = name.replace(/^بخش\s+/, "").trim();
  // A بخش gets B plus a stable ordinal. It does NOT get a county letter: all 34 carry no
  // county in parent_name (seed-bakhsh.ts writes NULL), and only one of them names one in
  // its own string. A letter that existed for one row out of 34 would be a code that reads
  // as if it encoded something it does not.
  //
  // Towns take T, not a letter of their own, precisely so this namespace is free: the first
  // بخش alphabetically is B1 and بومهن is a town, so a town letter of B would have made
  // UNIQUE(code) fail on the real data rather than in theory.
  if (name.startsWith("بخش")) return `B${index}`;
  return TOWN_CODE[clean] ?? `X${index}`;
}

/** A محله's code: the parent's number plus a zero-padded ordinal within it.
 *
 *  Zero-padded because these are compared as strings -- a route sheet sorts them, and
 *  "149" sorts after "1401" without the pad. */
export function mahalleCode(parentNo: number, ordinal: number): string {
  return `${parentNo}${String(ordinal).padStart(2, "0")}`;
}

export interface Placeish {
  name: string;
  lng: number;
  lat: number;
}

/** West to east, latitude breaking a tie.
 *
 *  The ordinal is geographic, not alphabetical. Alphabetical order matched west-to-east
 *  in 2 of 25 محله in منطقه 14 and 0 of 27 in منطقه 5 -- so sorting a route sheet by an
 *  alphabetical ordinal walks across the city in Persian-alphabet jumps. A code that
 *  looks like it encodes a drive order but doesn't is worse than no code, because a rep
 *  trusts it and drives an hour for nothing.
 *
 *  Longitude rather than distance from a start point: the districts are 10-30km across,
 *  and a straight line of longitude is a stable west-to-east walk that does not move when
 *  the route's origin does.
 *
 *  Deterministic, which matters more than it looks. scripts/assign-district-codes.ts
 *  numbers by position in this list, so if the order were not total and stable, a re-run
 *  would renumber محله and invalidate every printed route sheet already in a van. */
export function orderedMahalle<T extends Placeish>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
}

/** Deliberately empty. Geography lives in the `districts` table; the library derives codes
 *  from it and never lists a place, so no name here can go stale against the seed. Kept
 *  exported and asserted empty by tests/districtCodes.test.ts so that stays true. */
export const CODES: Record<string, string> = {};
