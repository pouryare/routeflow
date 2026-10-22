import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-avatar-tenancy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { readAvatarStem } = await import("@/lib/repo/avatars");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
  getDb().prepare("UPDATE users SET avatar_stem = 'face-b' WHERE id = ?").run(b.ownerId);
});

describe("readAvatarStem", () => {
  it("serves a face to its own company only", () => {
    expect(readAvatarStem(b.ownerId, b.orgId)).toBe("face-b");
    expect(readAvatarStem(b.ownerId, a.orgId)).toBeUndefined();
    expect(readAvatarStem(b.ownerId, null)).toBe("face-b");
  });
});
