#!/usr/bin/env node
// Architecture ratchet (audit step 1, docs/architecture-audit-2026-10-22.md). Counts a few
// structural smells and fails when one RISES above the recorded baseline, so the cleanup can
// only go forward. Like scripts/mobile-audit.mjs it is heuristic, not a parser.
//
//   node scripts/check-architecture.mjs            report the numbers and what they are made of
//   node scripts/check-architecture.mjs --check    fail if any number rose above the baseline
//   node scripts/check-architecture.mjs --write    record today's numbers as the baseline
//
// Metrics (all "lower is better"):
//   importCycles          strongly connected groups of 2+ files in the VALUE import graph
//                         (`import type` is ignored: it vanishes at runtime)
//   dbImportsOutsideLib   files under app/ and components/ that import the database handle
//                         directly (routes and pages should go through lib/repo)
//   dbModuleLines         size of lib/db.ts, the module step 3 splits up
//   unscopedTenantSelects SELECTs on a tenant table that name no organization_id, use no scope
//                         fragment (`${x.sql}`) and are not a keyed lookup: the shape of the
//                         cross-tenant reads fixed on 2026-10-22
//   agentLitterFiles      tracked files of another tool's workspace (.zoocode*, superpowers-cline)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "docs", "architecture-baseline.json");
const SOURCE_DIRS = ["app", "lib", "components"];
const ROOT_FILES = ["proxy.ts", "instrumentation.ts"];
const EXT = [".ts", ".tsx"];

function* walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* walk(rel);
    } else if (EXT.some((x) => e.name.endsWith(x)) && !e.name.endsWith(".d.ts")) yield rel.split(path.sep).join("/");
  }
}

export function sourceFiles() {
  return [...SOURCE_DIRS.flatMap((d) => [...walk(d)]), ...ROOT_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))];
}

/** Value imports of one source string (specifiers only). `import type` and `export type` are skipped. */
export function valueImports(src) {
  const out = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2]) continue; // `import type` / `export type`
    const clause = m[3] ?? "";
    // `import { type A, type B } from` imports nothing at runtime.
    if (m[1] === "import" && /^\{[^}]*\}$/.test(clause.trim())) {
      const names = clause.trim().slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith("type "))) continue;
    }
    out.push(m[4] ?? m[5]);
  }
  return out;
}

function resolveSpec(from, spec, files) {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return null;
  for (const cand of [base, ...EXT.map((x) => base + x), ...EXT.map((x) => `${base}/index${x}`)]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/** Tarjan's strongly connected components; returns the groups with 2+ nodes (or a self-loop). */
export function cycles(graph) {
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], groups = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (graph.get(v) ?? new Set()).has(v)) groups.push(comp.sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}

function importGraph(files) {
  const set = new Set(files);
  const graph = new Map();
  for (const f of files) {
    const deps = new Set();
    for (const spec of valueImports(fs.readFileSync(path.join(ROOT, f), "utf8"))) {
      const r = resolveSpec(f, spec, set);
      if (r && r !== f) deps.add(r);
    }
    graph.set(f, deps);
  }
  return graph;
}

function tenantTables() {
  const db = fs.readFileSync(path.join(ROOT, "lib", "database", "tenantTables.ts"), "utf8");
  const listed = [...db.match(/TENANT_TABLES\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  /* `users` carries organization_id but is not in TENANT_TABLES (it is created before the tenancy sweep),
     and two cross-tenant reads came from unscoped `FROM users` queries. */
  return [...new Set([...listed, "users"])];
}

/** SELECT statements that look cross-tenant (see the header). Each: { file, line, sql }. */
export function unscopedTenantSelects(files, tenants) {
  const out = [];
  for (const f of files) {
    if (f === "lib/db.ts" || f.startsWith("lib/database/")) continue;
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const re = /prepare\(\s*(`[^`]*`|"[^"\n]*")/g;
    let m;
    while ((m = re.exec(src))) {
      const sql = m[1].slice(1, -1);
      if (!/^\s*SELECT/i.test(sql)) continue;
      const from = [...sql.matchAll(/\bFROM\s+(\w+)/gi)].map((x) => x[1]);
      if (!from.some((t) => tenants.includes(t))) continue;
      if (/organization_id/.test(sql)) continue;
      if (/\$\{[\w.]*(sql|scope|filter|Filter|clause|where)\b[\w.()]*\}/.test(sql)) continue; // scope fragment
      if (/\bWHERE[^]*?\b(\w+\.)?(id|\w+_id|uuid|code|slug|username)\s*(=\s*\?|IN\s*\()/i.test(sql) && !/\bOR\b/i.test(sql)) continue; // keyed lookup
      // A WHERE assembled from a clauses/where array: scoped when the lines just above build it
      // from the organisation.
      if (/\$\{(clauses|where)\.join/.test(sql)) {
        const above = src.slice(0, m.index).split("\n").slice(-45).join("\n");
        if (/organization_id|organizationId|orgClause|orgFilter/.test(above)) continue;
      }
      out.push({ file: f, line: src.slice(0, m.index).split("\n").length, sql: sql.replace(/\s+/g, " ").slice(0, 110) });
    }
  }
  return out;
}

export function measure() {
  const files = sourceFiles();
  const groups = cycles(importGraph(files));
  const dbImports = files.filter(
    (f) => (f.startsWith("app/") || f.startsWith("components/")) && /from\s+["']@\/lib\/db["']/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))
      && /import\s*\{[^}]*\bgetDb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
  );
  const unscoped = unscopedTenantSelects(files, tenantTables());
  let litter = [];
  try {
    litter = execFileSync("git", ["ls-files", ".zoocode", ".zoocodeules", "superpowers-cline"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean);
  } catch { /* not a git checkout: nothing to count */ }
  const dbLines = fs.readFileSync(path.join(ROOT, "lib", "db.ts"), "utf8").split("\n").length;
  return {
    totals: {
      importCycles: groups.length,
      dbImportsOutsideLib: dbImports.length,
      dbModuleLines: dbLines,
      unscopedTenantSelects: unscoped.length,
      agentLitterFiles: litter.length,
    },
    detail: { cycles: groups, dbImports, unscoped },
  };
}

function main() {
  const mode = process.argv[2];
  const { totals, detail } = measure();
  if (mode === "--write") {
    fs.writeFileSync(BASELINE, JSON.stringify(totals, null, 2) + "\n");
    console.log("architecture baseline written:", totals);
    return;
  }
  if (mode === "--check") {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    const rose = Object.entries(totals).filter(([k, v]) => v > (base[k] ?? Infinity));
    for (const [k, v] of Object.entries(totals)) {
      const note = v < base[k] ? `  (down from ${base[k]}: run with --write to lock it in)` : "";
      console.log(`${k.padEnd(24)} ${String(v).padStart(6)}  baseline ${base[k]}${note}`);
    }
    if (rose.length) {
      console.error(`\nFAILED: ${rose.map(([k, v]) => `${k} ${base[k]} -> ${v}`).join(", ")}. See docs/architecture-audit-2026-10-22.md.`);
      if (rose.some(([k]) => k === "importCycles")) for (const g of detail.cycles) console.error("  cycle:", g.join(" <-> "));
      if (rose.some(([k]) => k === "unscopedTenantSelects")) for (const u of detail.unscoped) console.error(`  ${u.file}:${u.line}  ${u.sql}`);
      process.exit(1);
    }
    return;
  }
  console.log("totals:", totals);
  console.log("\nimport cycles:");
  for (const g of detail.cycles) console.log("  -", g.join(" <-> "));
  console.log("\nunscoped-looking tenant SELECTs:");
  for (const u of detail.unscoped) console.log(`  - ${u.file}:${u.line}  ${u.sql}`);
  console.log(`\nfiles in app/ and components/ importing getDb: ${detail.dbImports.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
