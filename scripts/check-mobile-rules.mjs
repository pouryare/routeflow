#!/usr/bin/env node
// Enforces docs/mobile-first-principles.md. Three checks, each failure naming the rule it breaks:
//   1. the audit ratchet (selects, native dates, text fields, tiny targets, confirm dialogs may only fall);
//   2. every components/mobile/*.tsx is covered by a test (or listed as presentational-only);
//   3. JalaliDateInput is imported only by the files already recorded in the baseline;
//   4. HeroUI's centred overlays and dropdowns are imported only by files recorded in the baseline.
//   node scripts/check-mobile-rules.mjs            run all checks
//   node scripts/check-mobile-rules.mjs --write    record today's importer list (with the audit baseline)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTree } from "./mobile-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "docs", "mobile-audit-baseline.json");
const ALLOW = path.join(ROOT, "scripts", "mobile-allowlist.json");

/** Pieces that are layout or wiring with no logic of their own, so no model test applies. */
export const PRESENTATIONAL_ONLY = {
  "BottomSheet.tsx": "the shared sheet shell; exercised through every sheet that uses it",
  "StickyAction.tsx": "a positioned bar; covered by the chrome CSS test",
  "DrillSheet.tsx": "a titled BottomSheet",
  "RecentsUser.tsx": "sets the user id for recents; one effect",
  "FilterSheet.tsx": "the sheet half of FilterChips, tested with it",
};

const RULE = {
  audit: "قانون ۴ و ۵ و ۶ (principles: chips, days, undo, 44px)",
  covered: "قانون ۱۶ (pure model + thin component + test)",
  dateInput: "قانون ۵ (days as words; the calendar only through DayChips or a desk form)",
  heroOverlay: "قانون ۹ و ۴ (sheets, not modals; chips before dropdowns): on a phone use Drawer, TagGroup or SmartPicker",
  allowlist: "بخش ۸ (every exemption needs a written reason)",
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) yield p;
  }
}

export function jalaliImporters() {
  const out = [];
  for (const d of ["app", "components"]) {
    for (const f of walk(path.join(ROOT, d))) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      if (rel === "components/meridian/JalaliDateInput.tsx") continue;
      if (/from\s+["'][^"']*JalaliDateInput["']/.test(fs.readFileSync(f, "utf8"))) out.push(rel);
    }
  }
  return out.sort();
}

/** HeroUI parts that open in the middle of the screen or beside their trigger, or that are a
 *  dropdown. Each is right on a desk and wrong on a phone path, where a bottom Drawer, chips or
 *  the SmartPicker do the job. HeroUI's Select is a button and a list box, not a native
 *  `<select>`, so the audit's select count never sees it; this list does. */
export const HERO_OVERLAYS = ["Modal", "AlertDialog", "Popover", "Dropdown", "Tooltip", "Select", "ComboBox"];

/** The files allowed to import one of HERO_OVERLAYS, each with the reason it is right there.
 *  A new importer fails the check until it is added here with its reason (section 8). */
export const HERO_OVERLAY_REASONS = {
  "components/meridian/HelpHint.tsx": "a few lines of help anchored to the (?) that asked for them; a sheet would cover the component it explains, and a Tooltip never opens on touch",
  "components/meridian/ProfileMenu.tsx": "the account and appearance panel hangs from the avatar in the top bar on every width; the phone's own way to these links is the «بیشتر» sheet",
  "components/AccentPicker.tsx": "ten swatches hanging from the colour button inside the profile panel and on the map; a sheet would hide the page the colour is being judged against",
  "components/FontPicker.tsx": "four faces hanging from the «آ» button inside the profile panel and on the map; a sheet would hide the text the face is being judged against",
  "components/NotificationBell.tsx": "the feed hangs from the bell it belongs to, kept on screen by React Aria; a sheet from the top bar would open at the opposite edge from the tap",
};

export function heroOverlayImporters() {
  const out = [];
  const named = new RegExp(`\\b(${HERO_OVERLAYS.join("|")})\\b`);
  for (const d of ["app", "components"]) {
    for (const f of walk(path.join(ROOT, d))) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@heroui\/react["']/g)) {
        if (named.test(m[1])) { out.push(rel); break; }
      }
    }
  }
  return out.sort();
}

export function untestedMobileComponents() {
  const dir = path.join(ROOT, "components", "mobile");
  const tests = [...walk(path.join(ROOT, "tests"))].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !(f in PRESENTATIONAL_ONLY))
    .filter((f) => !tests.includes(f.replace(/\.tsx$/, "")))
    .sort();
}

export function allowlistProblems() {
  const allow = JSON.parse(fs.readFileSync(ALLOW, "utf8"));
  const bad = [];
  for (const [file, e] of Object.entries(allow)) {
    if (!e || typeof e.reason !== "string" || e.reason.trim().length < 20) bad.push(`${file}: reason missing or too short`);
    if (!fs.existsSync(path.join(ROOT, file))) bad.push(`${file}: file no longer exists`);
  }
  return bad;
}

export function check() {
  const problems = [];
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const { total } = auditTree();
  for (const k of Object.keys(total)) {
    if (total[k] > (base.total[k] ?? 0)) problems.push(`${k}: ${total[k]} is above the baseline ${base.total[k]} — ${RULE.audit}`);
  }
  for (const f of untestedMobileComponents()) problems.push(`components/mobile/${f} has no test that names it — ${RULE.covered}`);
  const known = new Set(base.jalaliImporters ?? []);
  for (const f of jalaliImporters()) if (!known.has(f)) problems.push(`${f} imports JalaliDateInput — ${RULE.dateInput}`);
  for (const f of heroOverlayImporters()) if (!HERO_OVERLAY_REASONS[f]) problems.push(`${f} imports a HeroUI overlay or dropdown — ${RULE.heroOverlay}`);
  for (const p of allowlistProblems()) problems.push(`${p} — ${RULE.allowlist}`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--write") {
    const { total } = auditTree();
    fs.writeFileSync(BASELINE, JSON.stringify({ total, jalaliImporters: jalaliImporters() }, null, 2) + "\n");
    console.log("baseline written", total);
  } else {
    const problems = check();
    if (problems.length) {
      console.error("mobile rules broken:\n- " + problems.join("\n- "));
      process.exit(1);
    }
    console.log("mobile rules ok", auditTree().total);
  }
}
