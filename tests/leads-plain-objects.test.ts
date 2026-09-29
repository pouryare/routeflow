import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-leads-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readLeadPins } = await import("@/lib/repo/leads");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(() => {
  getDb().exec(
    /* maps_url is NOT NULL — the column list here is read off the live schema rather than
       guessed, which is a lesson this session repeated several times over. */
    `INSERT INTO saved_locations (name, lat, lng, organization_id, maps_url, created_at)
     VALUES ('pin', 35.7, 51.4, NULL, 'https://maps.example/pin', '2026-01-01')`
  );
});

/* node:sqlite hands back rows with a NULL prototype, and React refuses those across the
 * server→client boundary:
 *
 *   "Only plain objects, and a few built-ins, can be passed to Client Components
 *    from Server Components. Classes or null prototypes are not supported."
 *
 * The map page passes this array to a client component, so the raw rows threw on every
 * single load — a total outage of /map that no unit test could see, because the rows are
 * valid TypeScript. Only the browser suite caught it.
 *
 * The assertion is about the PROTOTYPE, not the values: `toEqual` and `toMatchObject` both
 * pass on a null-prototype object, which is precisely why the type system stayed silent. */
describe("readLeadPins", () => {
  it("returns plain objects, not node:sqlite's null-prototype rows", () => {
    const pins = readLeadPins(getDb());
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      expect(Object.getPrototypeOf(pin), `pin ${pin.id} has a null prototype`).toBe(Object.prototype);
    }
  });

  it("still returns the four fields it always did", () => {
    const [pin] = readLeadPins(getDb());
    expect(pin).toEqual({ id: pin.id, name: "pin", lat: 35.7, lng: 51.4 });
  });

  it("survives a structuredClone, which is what the RSC boundary does to it", () => {
    for (const pin of readLeadPins(getDb())) {
      expect(() => structuredClone(pin)).not.toThrow();
    }
  });
});
