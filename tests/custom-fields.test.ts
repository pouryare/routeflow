import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-cfield-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { checkValue, parseChoices, parseName, MAX_ACTIVE_FIELDS } = await import("@/lib/customFields");
const { activeFields, createField, updateField, valuesFor, setValues } = await import("@/lib/repo/customFields");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("F122 value checks", () => {
  it("accepts good values per type and clears on blank", () => {
    expect(checkValue({ kind: "number", choices: [] }, "۱٬۲۵۰")).toBe("1250");
    expect(checkValue({ kind: "yes_no", choices: [] }, true)).toBe("1");
    expect(checkValue({ kind: "choice", choices: ["عمده", "خرده"] }, "عمده")).toBe("عمده");
    expect(checkValue({ kind: "date", choices: [] }, "2026-11-13")).toBe("2026-11-13");
    expect(checkValue({ kind: "text", choices: [] }, "  ")).toBeNull();
  });
  it("refuses a wrong choice, a bad number and a bad date", () => {
    expect(checkValue({ kind: "choice", choices: ["الف", "ب"] }, "ج")).toHaveProperty("error");
    expect(checkValue({ kind: "number", choices: [] }, "abc")).toHaveProperty("error");
    expect(checkValue({ kind: "date", choices: [] }, "13-11-2026")).toHaveProperty("error");
  });
  it("parses names and choice lists", () => {
    expect(parseName("  نوع   مغازه ")).toBe("نوع مغازه");
    expect(parseName("")).toBeNull();
    expect(parseChoices("عمده، خرده,عمده")).toEqual(["عمده", "خرده"]);
    expect(parseChoices("فقط یکی")).toBeNull();
  });
});

describe("F122 fields and values", () => {
  it("creates, limits, archives, and saves values for one company only", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('CF','ویژگی','active',?,1)").run(now)).lastInsertRowid);
    expect(await createField(1, { name: "نوع مغازه", kind: "choice", choices: "عمده، خرده" })).toBeNull();
    expect(await createField(1, { name: "نوع مغازه", kind: "text" })).toMatch(/هست/);
    expect(await createField(1, { name: "x", kind: "choice", choices: "یک" })).toMatch(/گزینه/);
    const [f] = await activeFields(1);
    expect(await setValues(1, cust, { [f.id]: "عمده" })).toBeNull();
    expect((await valuesFor(1, cust))[0].value).toBe("عمده");
    expect(await setValues(1, cust, { [f.id]: "نامعلوم" })).toMatch(/گزینه/);
    expect((await valuesFor(1, cust))[0].value).toBe("عمده"); // refused save changed nothing
    expect(await setValues(2, cust, { [f.id]: "عمده" })).toBeTruthy(); // another company cannot reach it
    expect(await setValues(1, cust, { [f.id]: "" })).toBeNull();
    expect((await valuesFor(1, cust))[0].value).toBeNull();
    expect(await updateField(1, f.id, { archived: true })).toBeNull();
    expect(await activeFields(1)).toHaveLength(0);
    for (let i = 0; i < MAX_ACTIVE_FIELDS; i++) expect(await createField(1, { name: `ف${i}`, kind: "text" })).toBeNull();
    expect(await createField(1, { name: "یازدهم", kind: "text" })).toMatch(/حداکثر/);
  });
});
