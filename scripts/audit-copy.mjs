#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "docs", "copy-audit", "catalogue.md");
const PERSIAN = /[\u0600-\u06FF]/;

function readUtf8(p) { return fs.readFileSync(p, "utf8"); }
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return s.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkRoutes(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("[")) continue;
    if (e.name.startsWith("(")) { out.push(...walkRoutes(path.join(dir, e.name), base)); continue; }
    const url = `${base}/${e.name}`;
    if (fs.existsSync(path.join(dir, e.name, "page.tsx"))) out.push(url);
    out.push(...walkRoutes(path.join(dir, e.name), url));
  }
  return out;
}

function extractPersian(src) {
  const results = [];
  let m;
  const dq = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  while ((m = dq.exec(src)) !== null) { if (PERSIAN.test(m[1]) && !m[1].includes("${")) results.push({ string: m[1], start: m.index }); }
  const tmpl = /`([^`]*)`/g;
  while ((m = tmpl.exec(src)) !== null) { if (PERSIAN.test(m[1]) && !m[1].includes("${")) results.push({ string: m[1], start: m.index }); }
  return results;
}

function extractMapEntries(src) {
  const results = [];
  let m;
  const re = /\b(\w+):\s*"([^"\\]*(?:\\.[^"\\]*)*)"|\b(\w+):\s*`([^`]*)`/g;
  while ((m = re.exec(src)) !== null) {
    const val = m[2] ?? m[4] ?? "";
    if (PERSIAN.test(val)) results.push({ string: val, location: "lib/pageMeta.ts" });
  }
  return results;
}

function collectLabelMaps() {
  const mapPath = path.join(ROOT, "lib", "pageMeta.ts");
  if (!fs.existsSync(mapPath)) return [];
  return extractMapEntries(stripComments(readUtf8(mapPath)));
}

function detectRetiredWord(str) {
  for (const rw of [{ pattern: /ویزیت/, use: "بازدید" }, { pattern: /لیست/, use: "فهرست" }, { pattern: /(?<![؀-\u06FF])بچ(?![هس])/, use: "سری ساخت" }, { pattern: /داشبورد/, use: "خلاصهٔ فروش" }, { pattern: /پاکت/, use: "کارهای من" }]) {
    if (rw.pattern.test(str)) return { status: "RETIRED-WORD", note: `replace with «${rw.use}»` };
  }
  return null;
}
function detectRawEnum(str) {
  for (const re of [/\bstage\b/, /\bband\b/, /\bseverity\b/, /\bcategory\b/]) { if (re.test(str)) return { status: "RAW-ENUM", note: "use a Persian label map" }; }
  return null;
}
export function detectArabicChars(str) {
  /* The four Arabic letters a Persian keyboard slips into — U+0649 ARABIC YEH, U+0643
   * ARABIC KAF, U+064A ARABIC YEH (dotless, the one that looks Persian), U+0629 TEH
   * MARBUTA — plus two ranges that arrive in real copy and were missing until 2026-10-01:
   *
   *  - U+064B..U+0652, ARABIC diacritics (FATHATON..SUKUN).
   *  - U+FE70..U+FEFF, ARABIC PRESENTATION FORMS-A. This is the one that matters. The
   *    string for "عید سعید فطر" written as presentation glyphs RENDERS correctly, contains
   *    ZERO Persian codepoints, and is invisible to a human reviewing the rendered page — so
   *    it slips through review and lands in the database. Iranian holiday data arrives
   *    exactly like this: 178 such codepoints in the vendored IR.yaml.
   *
   *  NFKC repairs it mechanically: all 178 fold away and every yeh becomes PERSIAN U+06CC.
   *  Measured on the real file, not assumed — see tests/copy-audit-arabic.test.ts.
   *
   *  The /u flag is REQUIRED. Without it the range is read as 16 separate UTF-16 code units
   *  and the class does not mean what it looks like it means.
   *
   *  The class is unreviewable in a diff and easy to corrupt in transit, which is exactly
   *  why the test EXECUTES this function against real strings instead of asserting that a
   *  pattern like "FE70" appears somewhere in this file. */
  if (/[\u0649\u0643\u064A\u0629\u064B-\u0652\uFE70-\uFEFF]/u.test(str)) {
    return { status: "ARABIC-CHAR", note: "use Persian ی/ک, never Arabic or presentation forms" };
  }
  return null;
}
function detectUnlabelledEnum(str) {
  if (/\b[A-Z]{2,}\b/.test(str) && !str.includes("##") && !str.includes("|")) return { status: "UNLABELLED-ENUM", note: "English identifier in Persian context" };
  return null;
}
// Compare full words, not stems: "مکان" (singular) and "مکان‌ها" (plural) are
// different words and should NOT be flagged as inconsistent.
// Compare FULL strings, not stems. "مکان" and "مکان‌ها" are different words
// and must not be flagged as inconsistent.
function buildZWNJMismatches(allStrings) {
  const byNorm = new Map();
  for (const s of allStrings) {
    const norm = s.replace(/\u200c/g, "");
    if (!byNorm.has(norm)) byNorm.set(norm, new Set());
    byNorm.get(norm).add(s);
  }
  return byNorm;
}
function detectZWNJInconsistent(str, mismatches) {
  const norm = str.replace(/\u200c/g, "");
  const variants = mismatches.get(norm);
  if (variants && variants.size > 1) {
    return { status: "ZWNJ-INCONSISTENT", note: `ZWNJ variant of «${norm}»` };
  }
  return null;
}

function main() {
  const routes = walkRoutes(path.join(ROOT, "app", "(shell)"));
  const catalogByRoute = {};
  const allStrings = [];

  // 1. Collect label maps
  for (const lm of collectLabelMaps()) {
    const loc = lm.location;
    catalogByRoute[loc] = catalogByRoute[loc] || [];
    catalogByRoute[loc].push({ string: lm.string, file: loc, location: loc });
    allStrings.push(lm.string);
  }

  // 2. Walk routes and extract Persian strings from .tsx
  for (const route of routes) {
    const cleanRoute = route.startsWith("/") ? route : "/" + route;
    const pagePath = path.join(ROOT, "app", "(shell)", cleanRoute.replace(/^\//, ""), "page.tsx");
    if (!fs.existsSync(pagePath)) continue;
    const src = stripComments(readUtf8(pagePath));
    const found = extractPersian(src);
    if (found.length) {
      catalogByRoute[cleanRoute] = catalogByRoute[cleanRoute] || [];
      for (const f of found) {
        catalogByRoute[cleanRoute].push({ string: f.string, file: cleanRoute + "/page.tsx", location: cleanRoute + "/page.tsx" });
        allStrings.push(f.string);
      }
    }
  }

  // 3. Build ZWNJ mismatch stems
  const zwMismatches = buildZWNJMismatches(allStrings);

  // 4. Run detectors per-string
  const rowsByRoute = {};
  for (const route of Object.keys(catalogByRoute)) {
    rowsByRoute[route] = [];
    for (const item of catalogByRoute[route]) {
      const checks = [
        () => detectRetiredWord(item.string),
        () => detectRawEnum(item.string),
        () => detectArabicChars(item.string),
        () => detectZWNJInconsistent(item.string, zwMismatches),
        () => detectUnlabelledEnum(item.string),
      ];
      let det = { status: "OK", note: "—" };
      for (const check of checks) { const r = check(); if (r) { det = r; break; } }
      rowsByRoute[route].push({ route, ...item, status: det.status, detector: det.status, note: det.note });
    }
  }

  // 5. Ensure every route appears in the catalogue (even if no strings)
  for (const route of routes) {
    const cleanRoute = route.startsWith("/") ? route : "/" + route;
    if (!rowsByRoute[cleanRoute]) rowsByRoute[cleanRoute] = [];
  }

  // 6. Sort routes: real routes first (by path), then lib/ maps
  const realRoutes = Object.keys(rowsByRoute).filter(r => r.startsWith("/")).sort();
  const mapRoutes = Object.keys(rowsByRoute).filter(r => !r.startsWith("/")).sort();
  const allRouteKeys = [...realRoutes, ...mapRoutes];

  // 7. Write catalogue with per-route sections
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = ["# Persian Copy Catalogue", "", "Generated by scripts/audit-copy.mjs", "", "---", ""];
  let totalFlagged = 0;
  for (const route of allRouteKeys) {
    const rows = rowsByRoute[route];
    lines.push(`## ${route}`, "");
    lines.push("| String | Defined at | Status | Detector | Note |");
    lines.push("|--------|------------|--------|----------|------|");
    if (rows.length === 0) {
      lines.push("*No Persian strings found on this page.*", "");
    } else {
      for (const r of rows) {
        if (r.status !== "OK") totalFlagged++;
        lines.push(`| ${r.string} | ${r.file} | ${r.status} | ${r.detector} | ${r.note} |`);
      }
    }
    lines.push("");
  }
  lines.push("---", "", `Total: ${allStrings.length} strings, ${totalFlagged} flagged`);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`Written ${allStrings.length} strings (${totalFlagged} flagged) to ${OUT}`);
}
// ---- Wider scan: components, API messages, tap-flow definitions --------------------------
// The route catalogue above only reads page.tsx files. The buttons, toasts and error messages a
// person actually meets mostly live elsewhere, so this second report scans them and lists ONLY
// what a detector flags (the full list would be several thousand rows nobody reads).

const BARE_WORDS = new Set(["بستن", "لغو", "انصراف", "حذف", "ذخیره", "ویرایش", "ادامه", "افزودن", "ثبت", "بعدی", "قبلی", "تأیید", "تکمیل", "ایجاد", "بله", "خیر", "بعداً", "بازگشت", "نقشه"]);
const READABLE_LATIN = /\b(PDF|CSV|GPS|URL|SMS|PIN|Ctrl|ESC|WhatsApp|Telegram|OK)\b/g;
const WIDE_OUT = path.join(ROOT, "docs", "copy-audit", "catalogue-wide.md");

export function detectBareLabel(str) {
  if (BARE_WORDS.has(str.trim())) return { status: "BARE-LABEL", note: "name what it acts on: «بستن رسید», not «بستن»" };
  return null;
}
export function detectDevJargon(str) {
  if (/\$\{/.test(str)) return null; // template placeholders are handled by the caller's wording
  // «{name}» is a value filled in at runtime (tap-flow questions), not a code name.
  if (/[A-Za-z]/.test(str.replace(READABLE_LATIN, "").replace(/\{\w+\}/g, ""))) return { status: "DEV-JARGON", note: "field or code name in user-facing text" };
  return null;
}

function walkFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

function extractJsxText(src) {
  const results = [];
  const re = />\s*([^<>{}\n]*[\u0600-\u06FF][^<>{}\n]*?)\s*</g;
  let m;
  while ((m = re.exec(src)) !== null) results.push({ string: m[1].trim(), start: m.index });
  return results;
}

function wideScan() {
  const files = [
    ...walkFiles(path.join(ROOT, "components"), [".tsx"]),
    ...walkFiles(path.join(ROOT, "app", "api"), [".ts"]),
    ...walkFiles(path.join(ROOT, "lib", "crm", "flows"), [".ts"]),
  ].sort();
  const rows = [];
  let total = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const src = stripComments(readUtf8(file));
    const strings = [...extractPersian(src), ...extractJsxText(src)];
    for (const item of strings) {
      // A regex that ran across several lines of code is not a string anyone reads.
      if (/[\n<>]/.test(item.string)) continue;
      total++;
      // Vowel marks (U+064B–U+0652) are ordinary in authored Persian — «مثلاً», «قبلاً», «اولِ روز» — so
      // only Arabic letters and presentation forms flag here. The data-oriented check above stays strict.
      const checks = [(x) => detectArabicChars(x.replace(/[\u064B-\u0652]/g, "")), detectRetiredWord, detectBareLabel, detectDevJargon];
      for (const check of checks) {
        const r = check(item.string);
        if (r) { rows.push({ string: item.string, file: rel, ...r }); break; }
      }
    }
  }
  // English-looking field names live outside Persian strings in API errors, so catch those too.
  for (const file of files.filter((f) => f.includes(`${path.sep}api${path.sep}`))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const src = stripComments(readUtf8(file));
    const re = /error:\s*"([^"\n]*[\u0600-\u06FF][^"\n]*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const j = detectDevJargon(m[1]);
      if (j && !rows.some((r) => r.string === m[1] && r.file === rel)) rows.push({ string: m[1], file: rel, ...j });
    }
  }
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.string.localeCompare(b.string, "fa"));
  const lines = ["# Persian Copy — Wide Scan (flagged only)", "", "Generated by scripts/audit-copy.mjs. Scans components/, app/api/ and lib/crm/flows/.", "", "| String | Defined at | Status | Note |", "|--------|------------|--------|------|"];
  for (const r of rows) lines.push(`| ${r.string.replace(/\|/g, "\\|")} | ${r.file} | ${r.status} | ${r.note} |`);
  lines.push("", "---", "", `Scanned ${total} strings in ${files.length} files, ${rows.length} flagged`);
  fs.writeFileSync(WIDE_OUT, lines.join("\n") + "\n", "utf8");
  console.log(`Wide scan: ${total} strings, ${rows.length} flagged → ${WIDE_OUT}`);
}

/* Only run the audit when executed directly. tests/copy-audit-arabic.test.ts imports
   detectArabicChars from here, and an unconditional main() would rewrite
   docs/copy-audit/catalogue.md as a side effect of running that one test. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
  wideScan();
}
