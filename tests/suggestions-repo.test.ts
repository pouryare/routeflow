import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-suggestions-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { suggestionsFor } = await import("@/lib/repo/suggestions");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sess = (role: string): Session =>
  ({ user: { id: 1 } as never, role: role as never, groupId: null, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("suggestionsFor", () => {
  it("runs its queries cleanly on an empty database and suggests nothing", () => {
    getDb();
    expect(suggestionsFor(sess("phone_sales"))).toEqual([]);
  });
  it("is for phone sales only", () => {
    getDb();
    expect(suggestionsFor(sess("owner"))).toEqual([]);
  });
});

const { pendingForDeck } = await import("@/lib/repo/creditApprovals");
describe("pendingForDeck", () => {
  it("runs its join cleanly on an empty database", () => {
    getDb();
    expect(pendingForDeck(1)).toEqual([]);
  });
});
