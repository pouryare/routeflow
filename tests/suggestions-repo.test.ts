import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-suggestions-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { dbReady } = await import("@/lib/db");
const { suggestionsFor } = await import("@/lib/repo/suggestions");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sess = (role: string): Session =>
  ({ user: { id: 1 } as never, role: role as never, groupId: null, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("suggestionsFor", () => {
  it("runs its queries cleanly on an empty database and suggests nothing", async () => {
    await dbReady();
    expect(await suggestionsFor(sess("phone_sales"))).toEqual([]);
  });
  it("is for phone sales only", async () => {
    await dbReady();
    expect(await suggestionsFor(sess("owner"))).toEqual([]);
  });
});

const { pendingForDeck } = await import("@/lib/repo/creditApprovals");
describe("pendingForDeck", () => {
  it("runs its join cleanly on an empty database", async () => {
    await dbReady();
    expect(await pendingForDeck(1)).toEqual([]);
  });
});
