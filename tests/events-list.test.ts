import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* docs/events.md is the list of event names. A name used in code but missing there fails this test, so
   the list stays true (docs/plans/event-architecture-2026-11-12.md E5). */
const ROOT = path.resolve(import.meta.dirname, "..");
const doc = fs.readFileSync(path.join(ROOT, "docs", "events.md"), "utf8");

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(rel);
    else if (/\.tsx?$/.test(e.name)) yield rel;
  }
}

/** Every `kind: "a.b"` in app code: events and the notification kinds that share the shape. */
function kindsInCode(): Set<string> {
  const out = new Set<string>();
  for (const dir of ["lib", "app"]) {
    for (const f of sources(dir)) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of text.matchAll(/\bkind:\s*"([a-z_]+\.[a-z_]+)"/g)) out.add(m[1]);
    }
  }
  return out;
}

describe("docs/events.md", () => {
  it("names every event the code emits", () => {
    const missing = [...kindsInCode()].filter((k) => !doc.includes("`" + k + "`") && !doc.includes("`" + k + "`,"));
    expect(missing).toEqual([]);
  });

  it("names every move of the order state machine as order.<action>", () => {
    const sm = fs.readFileSync(path.join(ROOT, "lib", "orderStateMachine.ts"), "utf8");
    const union = sm.slice(sm.indexOf("export type OrderAction"), sm.indexOf("export type OrderRole"));
    const actions = [...union.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(10);
    expect(actions.filter((a) => !doc.includes("`" + a + "`"))).toEqual([]);
  });

  it("names every seeded rule that listens for an event or sweeps", async () => {
    process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-events-list-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    process.env.SESSION_SECRET = "test-secret";
    const { getDb } = await import("@/lib/db");
    const codes = ((await getDb().prepare("SELECT DISTINCT code FROM rules").all()) as { code: string }[]).map((r) => r.code);
    expect(codes.length).toBeGreaterThan(10);
    expect(codes.filter((c) => !doc.includes("`" + c + "`"))).toEqual([]);
  });
});
