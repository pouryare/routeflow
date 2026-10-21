#!/usr/bin/env node
// Heuristic counts of desktop-first patterns (selects, native date inputs, text fields, tiny
// tap targets, confirm dialogs). It is not a parser: it exists to make mobile-first progress
// visible and to stop regressions (the ratchet), not to be exact.
//
//   node scripts/mobile-audit.mjs            report totals and the worst files
//   node scripts/mobile-audit.mjs --write    record the current totals as the baseline
//   node scripts/mobile-audit.mjs --check    fail if any total rose above the baseline
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "docs", "mobile-audit-baseline.json");
const ALLOW = path.join(ROOT, "scripts", "mobile-allowlist.json");
const DIRS = ["app", "components"];

const RULES = {
  select: /<select\b/g,
  nativeDate: /type=["']date["']/g,
  textField: /<(?:input|textarea)\b/g,
  tinyTarget: null, // counted by countTinyTargets: only on controls, not on badges
  confirmDialog: /(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\(/g,
};

/** Occurrences of each rule in one source string. */
export function countRules(src) {
  return Object.fromEntries(
    Object.entries(RULES).map(([k, re]) => [k, re ? (src.match(re) ?? []).length : countTinyTargets(src)]),
  );
}

const TINY = /py-\[2px\]|py-0\.5\b/g;
const CONTROL_TAGS = new Set(["button", "a", "Link", "summary"]);

/** Tiny vertical padding only counts where someone taps: the nearest opening tag before the class
 *  is a button, link or summary, and the class is not already lifted by a 44px minimum or the
 *  `touch` utility on the same element. A badge (a span) with the same padding is not a target. */
export function countTinyTargets(src) {
  let n = 0;
  for (const m of src.matchAll(TINY)) {
    const open = src.lastIndexOf("<", m.index);
    const tag = /^<([A-Za-z][\w.]*)/.exec(src.slice(open, open + 40))?.[1];
    if (!tag || !CONTROL_TAGS.has(tag)) continue;
    const element = src.slice(open, m.index + 400);
    // The tag ends at the first `>` that is not the `=>` of an arrow function.
    const end = element.search(/[^=]>/);
    const attrs = end > 0 ? element.slice(0, end + 1) : element;
    if (/min-h-\[44px\]|\btouch\b/.test(attrs)) continue;
    n++;
  }
  return n;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) yield p;
  }
}

/** Totals over the tree, skipping files in the allowlist (desk-only surfaces, each with a
 *  written reason in scripts/mobile-allowlist.json). */
export function auditTree() {
  const allow = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, "utf8")) : {};
  const total = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
  const files = {};
  for (const d of DIRS) {
    for (const f of walk(path.join(ROOT, d))) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      if (allow[rel]) continue;
      const c = countRules(fs.readFileSync(f, "utf8"));
      for (const k of Object.keys(c)) total[k] += c[k];
      if (Object.values(c).some(Boolean)) files[rel] = c;
    }
  }
  return { total, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "--report";
  const { total, files } = auditTree();
  if (mode === "--write") {
    fs.writeFileSync(BASELINE, JSON.stringify({ total }, null, 2) + "\n");
    console.log("baseline written", total);
  } else if (mode === "--check") {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")).total;
    const worse = Object.keys(total).filter((k) => total[k] > (base[k] ?? 0));
    if (worse.length) {
      console.error("mobile-audit: regressed:", worse.map((k) => `${k} ${base[k] ?? 0} -> ${total[k]}`).join(", "));
      process.exit(1);
    }
    console.log("mobile-audit ok", total);
  } else {
    console.log(total);
    const sum = (c) => Object.values(c).reduce((x, y) => x + y, 0);
    for (const [f, c] of Object.entries(files).sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 25)) {
      console.log(f.padEnd(62), JSON.stringify(c));
    }
  }
}
