import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-problem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { addProblemReport, openProblemReports, markReportDone, screenshotOf, ReportError } = await import("@/lib/repo/problemReports");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("S24 problem reports", () => {
  it("keeps the line with its page, phone and version; refuses an empty one or a bad picture; marks done", async () => {
    const uid = Number((await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('rep24','x','Ali','phone_sales',1,'2026-01-01T00:00:00.000Z',1)").run()).lastInsertRowid);
    const s = { organizationId: 1, role: "phone_sales", user: { id: uid } } as unknown as Session;
    await expect(addProblemReport(s, { message: "  ", appVersion: "0.1.5" })).rejects.toThrow(ReportError);
    await expect(addProblemReport(s, { message: "x", screenshot: "javascript:alert(1)", appVersion: "0.1.5" })).rejects.toThrow(ReportError);
    await addProblemReport(s, { message: "دکمه کار نمی‌کند", page: "/sales/orders/new", connection: "online 4g", userAgent: "Mozilla", screenshot: "data:image/jpeg;base64,AAAA", appVersion: "0.1.5" });
    const rows = await openProblemReports(1);
    expect(rows[0]).toMatchObject({ who: "Ali", role: "phone_sales", page: "/sales/orders/new", connection: "online 4g", app_version: "0.1.5", has_screenshot: true });
    expect(await screenshotOf(1, rows[0].id)).toBe("data:image/jpeg;base64,AAAA");
    await markReportDone(1, rows[0].id);
    expect(await openProblemReports(1)).toHaveLength(0);
  });
});
