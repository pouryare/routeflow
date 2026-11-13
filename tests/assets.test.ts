import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-assets-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { addAsset, listAssets, updateAsset, AssetError } = await import("@/lib/repo/assets");
import type { Session } from "@/lib/session";
import type { Role } from "@/lib/roles";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner: Session;
let rep = 0;
async function user(name: string, role: Role): Promise<number> {
  const r = await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)").run(name, "x", name, role, "2026-01-01T00:00:00.000Z");
  return Number(r.lastInsertRowid);
}
const as = (id: number, role: Role): Session => ({ user: { id } as never, role, roles: [role], groupId: null, organizationId: 1, hasRole: (x: Role) => x === role });

beforeEach(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  owner = as(await user(`o-${tag}`, "owner"), "owner");
  rep = await user(`rep-${tag}`, "phone_sales");
});

describe("asset register", () => {
  it("adds a thing, gives it to someone, sets its condition, and retires it", async () => {
    await addAsset(owner, { kind: "phone", name: " موبایل علی ", serial: "SN-1" });
    const a = (await listAssets(owner)).find((x) => x.name === "موبایل علی")!;
    expect(a).toMatchObject({ kind: "phone", serial: "SN-1", holder_user_id: null, condition: "good" });
    await updateAsset(owner, a.id, { holder: rep, condition: "worn" });
    expect((await listAssets(owner)).find((x) => x.id === a.id)).toMatchObject({ holder_user_id: rep, condition: "worn" });
    await updateAsset(owner, a.id, { holder: null });
    expect((await listAssets(owner)).find((x) => x.id === a.id)).toMatchObject({ holder_user_id: null, holder_since: null });
    await updateAsset(owner, a.id, { holder: rep, retire: true });
    expect((await listAssets(owner)).some((x) => x.id === a.id)).toBe(false);
  });

  it("checks the input and who may use it", async () => {
    await expect(addAsset(owner, { kind: "boat", name: "x" })).rejects.toThrow(/نوع/);
    await expect(addAsset(owner, { kind: "van", name: "  " })).rejects.toThrow(AssetError);
    await expect(addAsset(as(rep, "phone_sales"), { kind: "van", name: "ون" })).rejects.toThrow(AssetError);
    await addAsset(owner, { kind: "key", name: "کلید انبار" });
    const a = (await listAssets(owner))[0];
    await expect(updateAsset(owner, a.id, { condition: "gone" })).rejects.toThrow(/نامعتبر/);
    await expect(updateAsset(owner, a.id, { holder: 999999 })).rejects.toThrow(/پیدا نشد/);
  });
});
