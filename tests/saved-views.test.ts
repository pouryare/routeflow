import { describe, it, expect } from "vitest";
import { canonicalQuery, sameView } from "@/lib/savedViews";

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-saved-views-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { saveView, listViews, deleteView } = await import("@/lib/repo/savedViews");

describe("FB6 saved views (pure)", () => {
  it("keeps only the known filter keys, sorted, without the page", () => {
    expect(canonicalQuery("status=open&day=today&page=3&x=1")).toBe("day=today&status=open");
    expect(sameView("day=today&status=open", "status=open&page=2&day=today")).toBe(true);
    expect(sameView("day=today", "day=week")).toBe(false);
  });
});

describe("FB6 saved views (stored)", () => {
  it("are personal: saved, changed, listed and deleted only by their owner", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (n: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,'x',?,'owner',?,1)").run(n, n, now)).lastInsertRowid);
    const a = await mk("sva");
    const b = await mk("svb");
    const id = await saveView(1, a, { name: "امروز باز", query: "day=today&status=open" });
    await expect(saveView(1, a, { name: "امروز باز", query: "day=week" })).rejects.toThrow(/نام/);
    await expect(saveView(1, a, { name: "x", query: "page=2" })).rejects.toThrow(/فیلتر/);
    await expect(saveView(1, b, { id, query: "day=week" })).rejects.toThrow(/پیدا/);
    await saveView(1, a, { id, query: "day=week" });
    expect((await listViews(1, a))[0].query).toBe("day=week");
    expect(await listViews(1, b)).toEqual([]);
    await deleteView(1, b, id);
    expect(await listViews(1, a)).toHaveLength(1);
    await deleteView(1, a, id);
    expect(await listViews(1, a)).toHaveLength(0);
  });
});
