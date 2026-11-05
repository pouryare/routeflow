#!/usr/bin/env node
// Every migration says in its header whether the previous release can still run after it:
//
//   -- rf: expand-only   only adds (new tables, nullable or defaulted columns, plain indexes, views,
//                        functions). `routeflow upgrade` may put the previous release back on its own.
//   -- rf: contract      changes or removes something the previous release uses. A failed upgrade
//                        then stops and asks a person instead of switching back.
//
// This fails when a migration has no marker, or is marked expand-only but contains a statement that
// is not (see RISKY). Run in CI and before every release: node scripts/check-migrations.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Statements that can break the previous release or reject what it writes. */
export const RISKY = [
  [/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TRIGGER|POLICY|TYPE|SCHEMA)\b/i, "drops something"],
  [/\bRENAME\b/i, "renames something"],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "changes a column type"],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, "makes a column required"],
  [/\bALTER\s+COLUMN\s+\S+\s+DROP\s+DEFAULT\b/i, "drops a column default"],
  [/\bADD\s+CONSTRAINT\b/i, "adds a constraint the old release's writes may break"],
  [/\bCREATE\s+UNIQUE\s+INDEX\b/i, "adds a unique index the old release's writes may break"],
  [/\b(UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i, "changes existing rows"],
  [/\b(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b|\bCREATE\s+POLICY\b/i, "changes who sees which rows"],
  [/\bREVOKE\b/i, "takes away a permission"],
];

/** The up part of a node-pg-migrate SQL file, without comments. */
export function upSql(text) {
  const up = text.split(/^--\s*Down Migration\b.*$/m)[0];
  return up.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** A column added NOT NULL without a DEFAULT: inserts from the old release fail. */
function addsRequiredColumn(sql) {
  for (const m of sql.matchAll(/\bADD\s+COLUMN\b([^,;]*)/gi)) {
    if (/\bNOT\s+NULL\b/i.test(m[1]) && !/\bDEFAULT\b/i.test(m[1])) return true;
  }
  return false;
}

/** Lower-case table name without schema or quotes. */
const bare = (t) => t.replace(/"/g, "").split(".").pop().toLowerCase();

/** The table a statement works on, when it names one. */
function targetTable(stmt) {
  const m =
    stmt.match(/\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([\w."]+)/i) ||
    stmt.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*?\bON\s+(?:ONLY\s+)?([\w."]+)/i) ||
    stmt.match(/\bCREATE\s+POLICY\s+\S+\s+ON\s+([\w."]+)/i);
  return m ? bare(m[1]) : null;
}

/** Why this SQL is not expand-only; empty when it only adds. Rules about constraints, unique
 *  indexes and row security do not count on a table this same file creates: the previous release
 *  never reads or writes a table it does not know. */
export function riskyStatements(text) {
  const sql = upSql(text);
  const created = new Set([...sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)].map((m) => bare(m[1])));
  const newTableOnly = new Set(["adds a constraint the old release's writes may break", "adds a unique index the old release's writes may break", "changes who sees which rows"]);
  const why = [];
  for (const stmt of sql.split(";")) {
    const table = targetTable(stmt);
    for (const [re, reason] of RISKY) {
      if (!re.test(stmt)) continue;
      if (newTableOnly.has(reason) && table && created.has(table)) continue;
      why.push(reason);
    }
    if (addsRequiredColumn(stmt) && !(table && created.has(table))) why.push("adds a required column with no default");
  }
  return [...new Set(why)];
}

export function marker(text) {
  const m = text.slice(0, 2000).match(/^--\s*rf:\s*(expand-only|contract)\b/m);
  return m ? m[1] : null;
}

/** Problems with one file, as lines to print. */
export function check(name, text) {
  const kind = marker(text);
  if (!kind) return [`${name}: no '-- rf: expand-only' or '-- rf: contract' line in its header`];
  if (kind === "expand-only") {
    return riskyStatements(text).map((why) => `${name}: marked expand-only but ${why}; mark it '-- rf: contract'`);
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
  const problems = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => check(f, fs.readFileSync(path.join(dir, f), "utf8")));
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log("migrations: every file is marked, and every expand-only one only adds");
}
