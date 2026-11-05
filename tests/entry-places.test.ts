import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-entry-places-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { parsePlace, withPlace, placeHref } = await import("@/lib/entryPlace");
const { saveEntryPlace, entryPlacesFor } = await import("@/lib/repo/entryPlaces");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("place on money entries (Z9)", () => {
  it("reads a place, ignores a bad one, and adds the phone's fix to a request", () => {
    expect(parsePlace({ lat: 35.7, lng: 51.4, accuracy_m: 12 })).toEqual({ lat: 35.7, lng: 51.4, accuracy_m: 12 });
    expect(parsePlace({ lat: 135, lng: 51 })).toBeNull();
    expect(parsePlace({ lat: null, lng: 51 })).toBeNull();
    expect(parsePlace(undefined)).toBeNull();
    expect(withPlace({ url: "/x", body: { a: 1 } }, null).body).toEqual({ a: 1 });
    expect(withPlace({ url: "/x", body: { a: 1 } }, { lat: 1, lng: 2, accuracy: 5 }).body).toEqual({ a: 1, place: { lat: 1, lng: 2, accuracy_m: 5 } });
    expect(placeHref({ lat: 35.7, lng: 51.4 })).toBe("/map?at=35.70000,51.40000,17");
  });

  it("keeps the first place of an entry, per company", async () => {
    await saveEntryPlace(1, "payment", 7, { lat: 35.7, lng: 51.4, accuracy_m: null });
    await saveEntryPlace(1, "payment", 7, { lat: 10, lng: 10, accuracy_m: null });
    await saveEntryPlace(1, "payment", 8, null);
    expect([...(await entryPlacesFor(1, "payment", [7, 8])).entries()]).toEqual([[7, { lat: 35.7, lng: 51.4 }]]);
    expect((await entryPlacesFor(2, "payment", [7])).size).toBe(0);
  });
});
