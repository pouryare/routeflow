import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `routeflow-test-runner-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const repo = await import("@/lib/repo/leadImport");
import type { LinkResolver } from "@/lib/leadImport/runner";
const { drainJob } = await import("@/lib/leadImport/runner");

const ORG = 1;

beforeAll(() => {
  getDb();
  getDb()
    .prepare(`INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)`)
    .run(ORG, "org", "org", new Date().toISOString());
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/** A resolver that answers from a table instead of the network, recording the order it
 *  was called in -- which is how the ordering assertions are made without a clock.
 *
 *  Each link gets its OWN coordinates, derived from its index. That is not decoration:
 *  a single shared pin would sit metres from the one the previous test saved, the
 *  dedupe pass would correctly call every link a duplicate of its neighbour, and
 *  added_count would be 0 for a reason that has nothing to do with the runner. Real
 *  venues are in different places, so the fixture has to be too. */
function stubResolver(calls: string[] = []): LinkResolver {
  return async (url: string) => {
    calls.push(url);
    // Derived from the URL, not from a running counter: every test shares one database,
    // so a counter would hand the same coordinates to two tests and the second would be
    // (correctly) rejected as a duplicate of the first.
    return {
      ...placeFor(url),
      address: "تهران",
      resolvedUrl: url,
      resolution: "direct",
    };
  };
}

function newJob(items: { name: string; mapsUrl: string }[]): number {
  const id = repo.createJob(ORG, null, items.length);
  repo.addItems(ORG, id, items);
  return id;
}

/** Links scoped to one test, so the rows a previous test saved cannot be mistaken for
 *  duplicates here. Re-pasting the same links is a real scenario, but it is what the
 *  duplicate test below is for -- not something every test should trip over. */
let urlSpace = 0;
function links(n: number): { name: string; mapsUrl: string }[] {
  const space = ++urlSpace;
  return Array.from({ length: n }, (_, i) => ({
    // The space is in the name as well as the URL: dedupe matches on name, so two
    // tests both using "مکان 2" would legitimately collide.
    name: `مکان تازه ${space}-${i}`,
    mapsUrl: `https://maps.example/s${space}/${i}`,
  }));
}

/** A stable, distinct location for a given URL.
 *
 *  Every resolver in this file places its links with this. Two links metres apart are
 *  genuinely the same venue as far as the dedupe pass is concerned, so a shared fixture
 *  pin would make every test after the first report added_count 0 for a reason that has
 *  nothing to do with the runner. Real pastes are links to different places. */
function placeFor(url: string): { lat: number; lng: number } {
  // Spread across Tehran at kilometre scale, never outside it. Two earlier versions of
  // this helper caused false failures: one multiplied a small hash by 0.001 and put
  // sibling links 136m apart -- inside the 150m radius the dedupe pass treats as one
  // venue -- and one let the hash run to 38.4N, where a name match against another
  // test's row made an unrelated link look like a duplicate. Real places are in the
  // city, kilometres apart.
  const h = [...url].reduce((a, c) => a + c.charCodeAt(0), 0);
  return { lat: 35.55 + (h % 300) * 0.01, lng: 51.2 + (h % 200) * 0.01 };
}

/** How many rows this one job added -- a delta, because the database is shared across
 *  every test in the file and an absolute count would be asserting on the tests above. */
function savedBy(jobId: number): number {
  return (getDb()
    .prepare(
      `SELECT COUNT(*) c FROM lead_import_items
        WHERE job_id = ? AND organization_id = ? AND saved_location_id IS NOT NULL`
    )
    .get(jobId, ORG) as unknown as { c: number }).c;
}

describe("drainJob", () => {
  it("decodes every link and saves the clean ones", async () => {
    const jobId = newJob(links(3));
    await drainJob(ORG, jobId, stubResolver());

    const job = repo.getJob(ORG, jobId)!;
    expect(job.status).toBe("done");
    expect(job.done_count).toBe(3);
    expect(job.added_count).toBe(3);
    expect(savedBy(jobId)).toBe(3);
  });

  it("never runs the same link twice", async () => {
    const calls: string[] = [];
    await drainJob(ORG, newJob(links(6)), stubResolver(calls));
    expect(new Set(calls).size).toBe(6);
    expect(calls).toHaveLength(6);
  });

  // One poisoned link must not end a run nine hundred links from finished.
  it("keeps going when one link's resolver throws", async () => {
    const jobId = newJob(links(4));
    let call = 0;
    await drainJob(ORG, jobId, async (url) => {
      call++;
      if (call === 1) throw new Error("chromium exploded");
      return { ...placeFor(url), address: null, resolvedUrl: url, resolution: "direct" };
    });

    const job = repo.getJob(ORG, jobId)!;
    expect(job.status).toBe("done");
    expect(job.done_count).toBe(3);
    expect(job.unresolved_count).toBe(1);
  });

  it("leaves an unresolvable link out of saved_locations but still finishes", async () => {
    const items = links(2);
    const jobId = newJob(items);
    await drainJob(ORG, jobId, async (url) =>
      url === items[0].mapsUrl
        ? { lat: null, lng: null, address: "?", resolvedUrl: url, resolution: "unresolved" as const }
        : { ...placeFor(url), address: null, resolvedUrl: url, resolution: "direct" as const }
    );

    const job = repo.getJob(ORG, jobId)!;
    expect(job.status).toBe("done");
    expect(job.added_count).toBe(1);
    expect(job.unresolved_count).toBe(1);
  });

  // A Nominatim hit is an area match. Auto-adding it plants a pin nobody checked.
  it("does not auto-add an approximate geocoder match", async () => {
    const jobId = newJob(links(1));
    await drainJob(ORG, jobId, async (url) => ({
      lat: 36.1, lng: 51.9, address: "تهران", resolvedUrl: url, resolution: "nominatim" as const,
    }));

    const job = repo.getJob(ORG, jobId)!;
    expect(job.added_count).toBe(0);
    expect(job.unresolved_count).toBe(1);
  });

  // The batch pickup goes cheapest-first even though every item starts as `pending`.
  it("settles fetch-decodable links before the expensive ones in the same batch", async () => {
    const jobId = newJob([
      { name: "سخت", mapsUrl: "https://maps.app.goo.gl/abcXYZ" },
      { name: "آسان", mapsUrl: "https://maps.google.com/maps/place/x/@35.7,51.4,14z" },
    ]);
    const calls: string[] = [];
    await drainJob(ORG, jobId, async (url) => {
      calls.push(url);
      const easy = url.includes("@35.7,51.4");
      return {
        ...placeFor(url), address: null, resolvedUrl: url,
        resolution: easy ? "direct" : "browser",
      };
    });
    expect(calls[0]).toBe("https://maps.google.com/maps/place/x/@35.7,51.4,14z");
  });

  // Cooperative, not a kill: whatever had already been decoded is kept.
  it("stops on cancel and keeps what had already been decoded", async () => {
    const jobId = newJob(links(8));
    let n = 0;
    await drainJob(ORG, jobId, async (url) => {
      n++;
      if (n === 4) repo.requestCancel(ORG, jobId);
      return { ...placeFor(url), address: null, resolvedUrl: url, resolution: "direct" };
    });

    const job = repo.getJob(ORG, jobId)!;
    expect(job.status).toBe("cancelled");
    expect(n).toBeLessThan(8);
    expect(job.done_count).toBeGreaterThan(0);
  });

  it("picks up a job a restart left half-finished, without redoing finished work", async () => {
    const jobId = newJob(links(4));
    // Simulate a crash: two items done, two still pending, job still marked running.
    const items = repo.listItems(ORG, jobId);
    for (const item of items.slice(0, 2)) {
      repo.markResolved(ORG, item.id, {
        lat: 35.7, lng: 51.4, address: null,
        resolvedUrl: item.maps_url, resolution: "direct", status: "done",
      });
    }
    expect(repo.getJob(ORG, jobId)!.status).toBe("running");

    const calls: string[] = [];
    await drainJob(ORG, jobId, stubResolver(calls));

    // Only the two unfinished links were re-resolved.
    expect(calls).toHaveLength(2);
    expect(repo.getJob(ORG, jobId)!.status).toBe("done");
  });

  it("does not duplicate saved links when a job is drained again", async () => {
    const jobId = newJob(links(2));
    await drainJob(ORG, jobId, stubResolver());
    const afterFirst = savedBy(jobId);
    await drainJob(ORG, jobId, stubResolver());
    // The second pass must add nothing: the unique index on (organization_id,
    // maps_url) is what stops a re-drain from saving the same pin twice.
    expect(afterFirst).toBe(2);
    expect(savedBy(jobId)).toBe(2);
  });

  it("finishes an empty job rather than spinning", async () => {
    const jobId = newJob([]);
    await drainJob(ORG, jobId, stubResolver());
    expect(repo.getJob(ORG, jobId)!.status).toBe("done");
  });
});

describe("a duplicate says what it duplicates", () => {
  // Regression: loadDuplicatePool's UNION omitted the `kind` column entirely, so every
  // match came back with existingKind undefined. The item was still correctly flagged a
  // duplicate, but the problem list could not tell the user whether the thing they
  // already have is a saved pin or a customer -- the one fact that makes the row
  // actionable. Only a test that asserts on the kind catches that.
  it("records location and customer duplicates distinctly", async () => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, organization_id, created_at, updated_at)
         VALUES ('کافه موجود', 'https://existing/loc', NULL, 35.62, 51.31, 'direct', ?, ?, ?)`
      )
      .run(ORG, now, now);
    // customers is a different shape: a required customer_code and synced_at, and its
    // tenant column was added by a later migration rather than the base DDL.
    getDb()
      .prepare(
        `INSERT INTO customers (customer_code, business_name, synced_at, organization_id)
         VALUES ('C-1', 'مشتری موجود', ?, ?)`
      )
      .run(now, ORG);

    const pool = repo.loadDuplicatePool(ORG);
    expect(pool.find((p) => p.name === "کافه موجود")?.kind).toBe("location");
    expect(pool.find((p) => p.name === "مشتری موجود")?.kind).toBe("customer");
  });

  it("carries the kind through to the item row", async () => {
    const jobId = newJob(links(1));
    const item = repo.listItems(ORG, jobId)[0];
    // Same coordinates and name as the row seeded above: a genuine duplicate.
    repo.markResolved(ORG, item.id, {
      lat: 35.62, lng: 51.31, address: null, resolvedUrl: item.maps_url,
      resolution: "direct", status: "duplicate",
      duplicateOf: "location", duplicateName: "کافه موجود",
    });
    const row = repo.listItems(ORG, jobId)[0];
    expect(row.status).toBe("duplicate");
    expect(row.duplicate_of).toBe("location");
    expect(row.duplicate_name).toBe("کافه موجود");
  });
});
