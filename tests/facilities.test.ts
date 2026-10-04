import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-facl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readFacilities, homeBase, mainWarehouse, defaultOrigin, FACILITY_LABEL } = await import("@/lib/facilities");
const { distanceKm } = await import("@/lib/geo");
const { isPlaced } = await import("@/lib/facilityTypes");
type LatLng = { lat: number; lng: number };

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  const db = getDb();
  // The app no longer seeds any facility -- every place is made by a person, through the
  // app -- so this file creates its own. Two real coordinates rather than invented ones,
  // because the point of most of these assertions is that an ORIGIN is chosen correctly,
  // and that needs two points far enough apart to tell them apart.
  const now = new Date().toISOString();
  const add = (slug: string, kind: string, name: string, lat: number, lng: number, origin: number) =>
    db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(slug, kind, name, lat, lng, origin, now, now);
  add("wh-test", "warehouse", "انبار آزمایشی", 35.502669, 51.7546255, 0);
  add("home-test", "home", "خانهٔ آزمایشی", 35.753263, 51.798381, 1);
});

describe("facilities", () => {
  it("has exactly one home base and one warehouse", () => {
    expect(homeBase()?.kind).toBe("home_base");
    expect(mainWarehouse()?.kind).toBe("warehouse");
  });

  // Coordinates now arrive from a pin somebody dropped, so the meaningful invariant is not
  // a range but the absence of the fabricated 0,0 that this column used to be forced to
  // carry: a place with no location is NULL, and NULL is a different thing from zero.
  it("never stores a fabricated 0,0 for a place nobody has positioned", () => {
    for (const f of readFacilities()) {
      expect(f.lat === 0 && f.lng === 0).toBe(false);
    }
  });

  it("measures a distance between two placed sites", () => {
    const home = homeBase()!;
    const wh = mainWarehouse()!;
    expect(isPlaced(home) && isPlaced(wh)).toBe(true);
    const km = distanceKm(home as LatLng, wh as LatLng);
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

  it("defaults the origin to the row carrying the flag", () => {
    expect(defaultOrigin()?.slug).toBe("home-test");
  });

  // A database whose flag was cleared -- by a bad restore, or a future bug -- must
  // still render rather than strand every distance in the app.
  it("falls back to the home base when no row carries the default flag", () => {
    const db = getDb();
    db.prepare("UPDATE facilities SET is_default_origin = 0").run();
    expect(defaultOrigin()?.kind).toBe("home_base");
    db.prepare("UPDATE facilities SET is_default_origin = 1 WHERE slug = 'home-test'").run();
  });

  // The flag is the FIRST choice, not the only one. A warehouse flagged as the origin must
  // beat the home base, because that is what the flag is for.
  it("prefers the flagged site over the home base", () => {
    const db = getDb();
    db.prepare("UPDATE facilities SET is_default_origin = 0").run();
    db.prepare("UPDATE facilities SET is_default_origin = 1 WHERE slug = 'wh-test'").run();
    expect(defaultOrigin()?.kind).toBe("warehouse");
    db.prepare("UPDATE facilities SET is_default_origin = 0").run();
    db.prepare("UPDATE facilities SET is_default_origin = 1 WHERE slug = 'home-test'").run();
  });

  // An unplaced facility is not an origin. Ranking first and dropping an unplaced winner
  // would return null precisely when the flagged site has no pin yet -- the one case where
  // the fallback has to work -- so the filter runs before the ranking.
  it("skips an unplaced facility rather than measuring from nothing", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
       VALUES ('wh-unplaced', 'warehouse', 'انبار بی‌موقعیت', NULL, NULL, 1, ?, ?)`
    ).run(now, now);
    expect(defaultOrigin()?.slug).toBe("home-test");
    db.prepare("DELETE FROM facilities WHERE slug = 'wh-unplaced'").run();
  });

  // ...but it is still a facility. "Exists but is not on the map yet" is the state the user
  // needs to see in order to fix it, so it must not vanish from the list.
  it("still lists a facility that has no location", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
       VALUES ('wh-unplaced2', 'warehouse', 'انبار بی‌موقعیت', NULL, NULL, 0, ?, ?)`
    ).run(now, now);
    expect(readFacilities().some((f) => f.slug === "wh-unplaced2")).toBe(true);
    db.prepare("DELETE FROM facilities WHERE slug = 'wh-unplaced2'").run();
  });

  // The popup prints the site's name as its title on the line directly above this
  // label, so a label equal to the name would render the same string twice.
  it("labels each kind by its role, not by a site's name", () => {
    for (const f of readFacilities()) expect(FACILITY_LABEL[f.kind]).not.toBe(f.name);
  });
});
