import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-sweep-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.SWEEP_TOKEN = "unit-test-sweep-token-0123456789";

const { getDb } = await import("@/lib/db");
const { POST: RULES_RUN } = await import("@/app/api/rules/run/route");
const { POST: ANALYSIS_REFRESH } = await import("@/app/api/analysis/refresh/route");
const { POST: PREDICT_REFRESH } = await import("@/app/api/predict/refresh/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
  delete process.env.SWEEP_TOKEN;
});

const withToken = (url: string, token: string) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "x-sweep-token": token } });
const bare = (url: string) => new NextRequest(`http://localhost${url}`, { method: "POST" });

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM organizations WHERE id > 1; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
});

describe("sweep auth (x-sweep-token)", () => {
  it("a valid token runs every org, no cookie needed", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Org Two', 'org-two', ?)").run(
      new Date().toISOString()
    );

    const res = await RULES_RUN(withToken("/api/rules/run", "unit-test-sweep-token-0123456789"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.via).toBe("token");
    expect(j.swept).toBe(2);
    expect(j.results.map((r: { organization_id: number }) => r.organization_id).sort()).toEqual([1, 2]);
    expect(typeof j.results[0].fired).toBe("number");
  });

  it("a wrong token falls through to the cookie gate → 401", async () => {
    expect((await RULES_RUN(withToken("/api/rules/run", "nope"))).status).toBe(401);
    expect((await ANALYSIS_REFRESH(withToken("/api/analysis/refresh", "nope"))).status).toBe(401);
    expect((await PREDICT_REFRESH(bare("/api/predict/refresh"))).status).toBe(401);
  });

  it("the single-org body keeps its flat shape for the browser buttons", async () => {
    const a = await (await ANALYSIS_REFRESH(withToken("/api/analysis/refresh", "unit-test-sweep-token-0123456789"))).json();
    expect(a.swept).toBe(1);
    expect(a.period).toBeTruthy(); // spread from results[0]
    expect(typeof a.written).toBe("number");

    const p = await (await PREDICT_REFRESH(withToken("/api/predict/refresh", "unit-test-sweep-token-0123456789"))).json();
    expect(p).toHaveProperty("forecasts");
    expect(p).toHaveProperty("churn");
    expect(p).toHaveProperty("capacity");
  });
});
