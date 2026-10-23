import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `routeflow-test-lead-import-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, dbReady } = await import("@/lib/db");
const repo = await import("@/lib/repo/leadImport");

const ORG_A = 1;
const ORG_B = 2;

async function seedOrg(id: number): Promise<void> {
  // `slug` is NOT NULL and UNIQUE on organizations, and every tenant-scoped table
  // references it -- seeding without it fails the foreign key, not the insert.
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)`
    )
    .run(id, `org-${id}`, `org-${id}`, new Date().toISOString());
}

beforeAll(async () => {
  await dbReady();
  await seedOrg(ORG_A);
  await seedOrg(ORG_B);
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

async function newJob(org = ORG_A, total = 3): Promise<number> {
  const id = await repo.createJob(org, null, total);
  await repo.addItems(
    org,
    id,
    Array.from({ length: total }, (_, i) => ({ name: `مکان ${i}`, mapsUrl: `https://maps.example/${org}/${i}` }))
  );
  return id;
}

describe("lead import job lifecycle", () => {
  it("creates a running job with its items in paste order", async () => {
    const id = await newJob();
    const job = (await repo.getJob(ORG_A, id))!;
    expect(job.status).toBe("running");
    expect(job.stage).toBe("parse");
    expect(job.total).toBe(3);
    expect(job.notified_at).toBeNull();

    const items = await repo.listItems(ORG_A, id);
    expect(items.map((i) => i.ordinal)).toEqual([0, 1, 2]);
    expect(items[0].status).toBe("pending");
    expect(items[0].name).toBe("مکان 0");
  });

  // The whole feature is tenant-scoped; a job must never be readable across orgs.
  it("does not expose a job to another organisation", async () => {
    const id = await newJob(ORG_A);
    expect(await repo.getJob(ORG_B, id)).toBeUndefined();
    expect(await repo.listItems(ORG_B, id)).toEqual([]);
    expect(await repo.pendingItems(ORG_B, id)).toEqual([]);
  });

  it("moves an item from pending to resolving only once", async () => {
    const id = await newJob(ORG_A, 1);
    const item = (await repo.listItems(ORG_A, id))[0];
    await repo.markResolving(ORG_A, item.id);
    expect((await repo.listItems(ORG_A, id))[0].status).toBe("resolving");
    // A second mark must not resurrect an item already handed to the resolver.
    await repo.markResolving(ORG_A, item.id);
    expect((await repo.listItems(ORG_A, id))[0].status).toBe("resolving");
  });

  it("counts done, unresolved and duplicate separately", async () => {
    const id = await newJob(ORG_A, 4);
    const items = await repo.listItems(ORG_A, id);
    await repo.markResolved(ORG_A, items[0].id, {
      lat: 35.7, lng: 51.4, address: "تهران", resolvedUrl: "u0", resolution: "direct", status: "done",
    });
    await repo.markResolved(ORG_A, items[1].id, {
      lat: null, lng: null, address: null, resolvedUrl: "u1", resolution: "unresolved", status: "unresolved",
    });
    await repo.markResolved(ORG_A, items[2].id, {
      lat: 35.8, lng: 51.5, address: null, resolvedUrl: "u2", resolution: "direct", status: "duplicate",
      duplicateOf: "location", duplicateName: "موجود",
    });
    await repo.refreshCounters(ORG_A, id);

    const job = (await repo.getJob(ORG_A, id))!;
    expect(job.done_count).toBe(1);
    expect(job.unresolved_count).toBe(2); // unresolved + duplicate both need a human
    expect(job.duplicate_count).toBe(1);
  });

  it("never counts more done than there were items", async () => {
    const id = await newJob(ORG_A, 2);
    const items = await repo.listItems(ORG_A, id);
    for (const it of items) {
      await repo.markResolved(ORG_A, it.id, {
        lat: 35.7, lng: 51.4, address: null, resolvedUrl: it.maps_url, resolution: "direct", status: "done",
      });
    }
    await repo.refreshCounters(ORG_A, id);
    const job = (await repo.getJob(ORG_A, id))!;
    expect(job.done_count).toBe(2);
    expect(job.done_count).toBeLessThanOrEqual(job.total);
  });

  it("finishes a job and stops offering it as queued", async () => {
    const id = await newJob(ORG_A, 1);
    await repo.finishJob(ORG_A, id, "done");
    const job = (await repo.getJob(ORG_A, id))!;
    expect(job.status).toBe("done");
    expect(job.stage).toBe("finish");
    expect(job.finished_at).not.toBeNull();
    expect((await repo.nextQueuedJob(ORG_A))?.id).not.toBe(id);
  });

  it("cancels a running job and reports it cancelled to the runner", async () => {
    const id = await newJob(ORG_A, 1);
    expect(await repo.isCancelled(ORG_A, id)).toBe(false);
    await repo.requestCancel(ORG_A, id);
    expect(await repo.isCancelled(ORG_A, id)).toBe(true);
    expect((await repo.getJob(ORG_A, id))!.status).toBe("cancelled");
  });

  // Three open tabs polling the same slow job must produce one notification, not three.
  it("lets exactly one caller claim the slow-job notification", async () => {
    const id = await newJob(ORG_A, 1);
    expect(await repo.claimNotification(ORG_A, id)).toBe(true);
    expect(await repo.claimNotification(ORG_A, id)).toBe(false);
    expect(await repo.claimNotification(ORG_A, id)).toBe(false);
    expect((await repo.getJob(ORG_A, id))!.notified_at).not.toBeNull();
  });

  it("finds a job orphaned by a restart", async () => {
    const id = await newJob(ORG_A, 1);
    expect((await repo.orphanedJobs()).map((j) => j.id)).toContain(id);
    await repo.finishJob(ORG_A, id, "done");
    expect((await repo.orphanedJobs()).map((j) => j.id)).not.toContain(id);
  });
});

describe("undo", () => {
  async function seedSavedLocation(org: number, name: string, visitOutcome: string | null): Promise<number> {
    const now = new Date().toISOString();
    const res = await getDb()
      .prepare(
        `INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, organization_id, created_at, updated_at, visit_outcome)
         VALUES (?, ?, 'Tehran', 35.7, 51.4, 'direct', ?, ?, ?, ?)`
      )
      .run(name, `https://maps.example/saved/${org}/${name}`, org, now, now, visitOutcome);
    return Number(res.lastInsertRowid);
  }

  it("removes only the rows this job created", async () => {
    const jobId = await newJob(ORG_A, 1);
    const item = (await repo.listItems(ORG_A, jobId))[0];

    const mine = await seedSavedLocation(ORG_A, "از-این-کار", null);
    const someoneElses = await seedSavedLocation(ORG_A, "قبلی", null);
    await repo.linkSavedLocation(ORG_A, item.id, mine);

    const removed = await repo.undoJob(ORG_A, jobId);
    expect(removed).toBe(1);

    const remaining = await getDb()
      .prepare(`SELECT id FROM saved_locations WHERE organization_id = ?`)
      .all(ORG_A) as unknown as { id: number }[];
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(mine);
    expect(ids).toContain(someoneElses);
  });

  // A pin somebody has already visited is a real record of a real visit, not a leftover
  // from an import. Undo must leave it alone.
  it("leaves a pin alone once it has been visited", async () => {
    const jobId = await newJob(ORG_A, 1);
    const item = (await repo.listItems(ORG_A, jobId))[0];
    const visited = await seedSavedLocation(ORG_A, "دیده-شده", "met_owner");
    await repo.linkSavedLocation(ORG_A, item.id, visited);

    expect(await repo.undoJob(ORG_A, jobId)).toBe(0);
    const row = await getDb()
      .prepare(`SELECT id FROM saved_locations WHERE id = ?`)
      .get(visited) as unknown as { id: number } | undefined;
    expect(row).toBeDefined();
  });

  it("never deletes another organisation's row", async () => {
    const jobA = await newJob(ORG_A, 1);
    const itemA = (await repo.listItems(ORG_A, jobA))[0];
    const orgBRow = await seedSavedLocation(ORG_B, "مال-سازمان-دیگر", null);
    // Deliberately link an org-B row to an org-A item: undo must refuse to cross tenants.
    await repo.linkSavedLocation(ORG_A, itemA.id, orgBRow);

    expect(await repo.undoJob(ORG_A, jobA)).toBe(0);
    const row = await getDb()
      .prepare(`SELECT id FROM saved_locations WHERE id = ?`)
      .get(orgBRow) as unknown as { id: number } | undefined;
    expect(row).toBeDefined();
  });
});
