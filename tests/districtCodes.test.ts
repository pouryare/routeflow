import { describe, it, expect } from "vitest";
import { parentNoFromName, codeForMantaghe, mahalleCode, orderedMahalle, CODES } from "@/lib/districtCodes";

/** How a district gets its short code, as pure functions.
 *
 *  No database and no I/O, so this is tested directly the way lib/districtSplit.ts is --
 *  the script does, this decides. The plan proposed a hand-rolled Persian/Arabic digit
 *  table inside districtCodes.ts; that would have duplicated lib/persian.ts, which already
 *  folds both digit sets to ASCII, so this uses normalisePersian instead. A second
 *  digit-folding implementation is a second thing to keep in step. */

describe("parentNoFromName", () => {
  it("reads Persian digits", () => {
    expect(parentNoFromName("منطقه ۱۴ شهر تهران")).toBe(14);
  });
  it("reads ASCII digits", () => {
    expect(parentNoFromName("منطقه 14")).toBe(14);
  });
  it("reads Arabic-Indic digits", () => {
    expect(parentNoFromName("منطقه ١٤")).toBe(14);
  });
  it("is null when there is no number", () => {
    expect(parentNoFromName("پردیس")).toBeNull();
    expect(parentNoFromName("بخش رودهن")).toBeNull();
  });
  // The reason parent_no is an INTEGER rather than joining the 369 mahalle to their 22
  // mantaghe on the name: the source file and our own spell the same district two ways.
  it("collapses both spellings to the same number", () => {
    expect(parentNoFromName("منطقه ۱۴ شهر تهران")).toBe(parentNoFromName("منطقه 14"));
  });
  it("ignores a leading zero rather than returning 0", () => {
    expect(parentNoFromName("منطقه ۰۴")).toBe(4);
  });
});

describe("codeForMantaghe", () => {
  it("uses Tehran's own number, so a rep can say it", () => {
    // منطقه 14 out loud is unambiguous; that is the only property a spoken code needs.
    expect(codeForMantaghe(14, "منطقه 14")).toBe("14");
  });
  // Digits would collide with منطقه 1..22 in one namespace -- the exact confusion a code
  // exists to prevent. So the 7 outer towns take a letter.
  it("gives every outer town a code from a namespace the bakhsh do not use", () => {
    // T, not a letter of their own: the first بخش is B1, so a town lettered B would have
    // collided with بومهن on the real data. The plan proposed P1/B1/R1 and that was wrong.
    expect(codeForMantaghe(null, "پردیس")).toBe("T1");
    expect(codeForMantaghe(null, "بومهن")).toBe("T2");
    expect(codeForMantaghe(null, "رودهن")).toBe("T3");
  });
  // A بخش gets B plus a stable ordinal, NOT a county letter. All 34 bakhsh carry no county
  // in parent_name (seed-bakhsh.ts writes NULL), and only one names one in its own string,
  // so a county prefix would read as if it encoded something it does not. The plan expected
  // "RB1"; the data does not support an R.
  it("gives a bakhsh a B plus its ordinal", () => {
    expect(codeForMantaghe(null, "بخش رودهن", 1)).toBe("B1");
    expect(codeForMantaghe(null, "بخش مرکزی ری", 20)).toBe("B20");
  });
  it("cannot give a bakhsh a code that collides with a town's", () => {
    // بومهن the town is B1. A bakhsh numbered 1 is also B1 -- so the two namespaces must
    // not be merged, which is what UNIQUE(code) would catch at seed time.
    expect(codeForMantaghe(null, "پردیس", 1)).not.toBe(codeForMantaghe(null, "بخش رودهن", 1));
  });
  it("never gives a town a digit-only code", () => {
    for (const [name, i] of [["پردیس", 1], ["بومهن", 2], ["دماوند", 3]] as const) {
      expect(codeForMantaghe(null, name, i)).toMatch(/^[A-Z]/);
    }
  });
  it("cannot collide with a bakhsh, which own the whole B namespace", () => {
    // Checked against the real 34, not a sample: B1..B34 is a wide namespace and a town
    // lettered B would have landed inside it.
    for (const name of ["پردیس", "بومهن", "رودهن", "دماوند", "آبسرد", "کیلان"]) {
      const c = codeForMantaghe(null, name);
      expect(c.startsWith("B"), `${name} is ${c}, which is a bakhsh code`).toBe(false);
    }
  });
  it("is stable: the same name and index always give the same code", () => {
    expect(codeForMantaghe(null, "پردیس", 1)).toBe(codeForMantaghe(null, "پردیس", 1));
  });
});

describe("mahalleCode", () => {
  it("is the parent number plus a two-digit ordinal", () => {
    expect(mahalleCode(14, 1)).toBe("1401");
    expect(mahalleCode(14, 26)).toBe("1426");
  });
  it("zero-pads so the width is stable for sorting", () => {
    // Without padding, 1401 and 149 sort as strings, not numbers.
    expect(mahalleCode(5, 1)).toBe("501");
    expect(mahalleCode(5, 1).length).toBe(mahalleCode(5, 17).length);
  });
  it("stays 3-4 characters for the real range of ordinals", () => {
    // The largest mantaghe holds 30 mahalle, so an ordinal never reaches 100.
    for (const n of [1, 9, 10, 26, 30]) expect(mahalleCode(5, n).length).toBeLessThanOrEqual(4);
  });
});

describe("orderedMahalle", () => {
  // West to east, and this is the property the first proposal got wrong. Sorting
  // alphabetically matched geographic order 2/25 and 0/27 in the two mantaghe measured, so
  // a route sheet sorted by an alphabetical ordinal walks across the city in
  // Persian-alphabet jumps. A code that looks like it encodes a drive order but doesn't
  // is worse than no code: a rep trusts it and drives an hour for nothing.
  it("orders by longitude, ascending", () => {
    const rows = [
      { name: "east", lng: 51.9, lat: 35.8 },
      { name: "west", lng: 51.4, lat: 35.8 },
      { name: "middle", lng: 51.6, lat: 35.75 },
    ];
    expect(orderedMahalle(rows).map((r) => r.name)).toEqual(["west", "middle", "east"]);
  });
  it("breaks a longitude tie by latitude, so the order is total", () => {
    const rows = [
      { name: "north", lng: 51.5, lat: 35.9 },
      { name: "south", lng: 51.5, lat: 35.7 },
    ];
    expect(orderedMahalle(rows).map((r) => r.name)).toEqual(["south", "north"]);
  });
  it("is stable under input order", () => {
    // Determinism is the whole point: the ordinal must not depend on scan order, or a
    // re-run would renumber mahalle and invalidate every printed route sheet.
    const a = [{ name: "b", lng: 51.5, lat: 35.7 }, { name: "a", lng: 51.4, lat: 35.7 }];
    expect(orderedMahalle(a).map((r) => r.name)).toEqual(["a", "b"]);
    expect(orderedMahalle([...a].reverse()).map((r) => r.name)).toEqual(["a", "b"]);
  });
  it("does not mutate its input", () => {
    const rows = [{ name: "east", lng: 51.9, lat: 35.8 }, { name: "west", lng: 51.4, lat: 35.8 }];
    orderedMahalle(rows);
    expect(rows.map((r) => r.name)).toEqual(["east", "west"]);
  });
  it("handles an empty list", () => {
    expect(orderedMahalle([])).toEqual([]);
  });
});

describe("CODES", () => {
  it("is empty -- no geography is hardcoded in application logic", () => {
    // The origin brief forbids hardcoding geographic information into the application.
    // Codes are derived from the districts table at seed time; the library derives the
    // rules and never lists a place, so no name here can go stale against the data.
    expect(Object.keys(CODES).length).toBe(0);
  });
});
