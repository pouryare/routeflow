import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "audit-copy.mjs");
const OUT = join(ROOT, "docs", "copy-audit", "catalogue.md");

function staticRoutes(dir: string, base = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = `${base}/${e.name}`;
    if (!e.isDirectory()) return [];
    if (e.name.startsWith("[")) return [];
    if (e.name.startsWith("(")) return staticRoutes(join(dir, e.name), base);
    const url = `${base}/${e.name}`;
    const out = existsSync(join(dir, e.name, "page.tsx")) ? [url] : [];
    return [...out, ...staticRoutes(join(dir, e.name), url)];
  });
}

describe("copy audit generator", () => {
  it("exits cleanly", () => {
    expect(() => execFileSync("node", [SCRIPT])).not.toThrow();
  });

  it("writes a catalogue", () => {
    expect(existsSync(OUT)).toBe(true);
  });

  it("covers every shell route", () => {
    const routes = staticRoutes(join(ROOT, "app", "(shell)"));
    const cat = readFileSync(OUT, "utf8");
    for (const r of routes) expect(cat, r).toContain(`## ${r}`);
  });

  it("regeneration is byte-identical (no hand-edits)", () => {
    const before = readFileSync(OUT, "utf8");
    execFileSync("node", [SCRIPT]);
    const after = readFileSync(OUT, "utf8");
    expect(after).toBe(before);
  });

  it("every flag is explainable (detector + note present for non-OK rows)", () => {
    const cat = readFileSync(OUT, "utf8");
    const rows = cat.split("\n").filter(l => l.startsWith("|"));
    for (const row of rows) {
      const cols = row.split("|").map(c => c.trim());
      // columns: String | Defined at | Status | Detector | Note
      if (cols.length >= 5 && cols[2] !== "OK" && cols[2] !== "Status") {
        expect(cols[2], `row ${row.slice(0, 40)}`).not.toBe("");
        expect(cols[3], `row ${row.slice(0, 40)}`).not.toBe("");
        expect(cols[4], `row ${row.slice(0, 40)}`).not.toBe("");
      }
    }
  });
});