import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-facl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readFacilities, homeBase, mainWarehouse, defaultOrigin, FACILITY_LABEL } = await import("@/lib/facilities");
const { distanceKm } = await import("@/lib/geo");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

describe("facilities", () => {
  it("has exactly one home base and one warehouse", () => {
    expect(homeBase()?.kind).toBe("home_base");
    expect(mainWarehouse()?.kind).toBe("warehouse");
  });

  // These coordinates came off the two Google Maps links the business shared and can't
  // be re-derived from anything else in the repo -- a typo would silently move a depot
  // kilometres away and nothing else would complain. Wide enough to survive a genuine
  // relocation inside the province, tight enough to catch a transposed digit or a
  // swapped lat/lng pair.
  it("places every site inside Tehran province", () => {
    for (const f of readFacilities()) {
      expect(f.lat).toBeGreaterThan(35.0);
      expect(f.lat).toBeLessThan(36.5);
      expect(f.lng).toBeGreaterThan(50.5);
      expect(f.lng).toBeLessThan(53.0);
    }
  });

  it("keeps the two sites the distance apart the links put them", () => {
    const km = distanceKm(homeBase()!, mainWarehouse()!);
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(32);
  });

  // React refuses to pass a null-prototype object into a Client Component, and the
  // server-rendered map page does exactly that with this list.
  it("returns plain objects, not the null-prototype rows node:sqlite hands back", () => {
    expect(Object.getPrototypeOf(readFacilities()[0])).toBe(Object.prototype);
  });

  it("lists the home base first, since it is the origin runs start from", () => {
    expect(readFacilities()[0].kind).toBe("home_base");
  });

  it("defaults the origin to the home base", () => {
    expect(defaultOrigin()?.slug).toBe("home-pardis");
  });

  // A database whose flag was cleared -- by a bad restore, or a future bug -- must
  // still render rather than strand every distance in the app.
  it("falls back to the home base when no row carries the default flag", () => {
    const db = getDb();
    db.prepare("UPDATE facilities SET is_default_origin = 0").run();
    expect(defaultOrigin()?.kind).toBe("home_base");
    db.prepare("UPDATE facilities SET is_default_origin = 1 WHERE slug = 'home-pardis'").run();
  });

  // The popup prints the site's name as its title on the line directly above this
  // label, so a label equal to the name would render the same string twice.
  it("labels each kind by its role, not by a site's name", () => {
    for (const f of readFacilities()) expect(FACILITY_LABEL[f.kind]).not.toBe(f.name);
  });
});
