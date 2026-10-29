import { describe, it, expect } from "vitest";
process.env.ROUTEFLOW_DB_PATH = `${process.env.TMPDIR ?? "/tmp"}/rf-repo-base-${Date.now()}.db`;
process.env.SESSION_SECRET = "test-secret";

const { makeRepo } = await import("@/lib/repo/base");

describe("makeRepo column names", () => {
  const repo = makeRepo<{ id: number; title: string }>("task_recurrences", { tenant: true });
  it("refuses a key that is not a plain column name", async () => {
    await expect(repo.patch(1, 1, { "title = (SELECT 1), kind": "x" } as never)).rejects.toThrow(/Invalid column/);
    await expect(repo.list(1, { "1=1 OR title": "x" } as never)).rejects.toThrow(/Invalid column/);
    await expect(repo.insert(1, { "a) VALUES (1); --": 1 } as never)).rejects.toThrow(/Invalid column/);
  });
  it("never patches id or organization_id", async () => {
    await expect(repo.patch(1, 1, { organization_id: 2 } as never)).rejects.toThrow(/Invalid column/);
  });
});
