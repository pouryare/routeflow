/** Asserts every token pair MASTER.md makes a claim about still holds.
 *
 *  Reads the real values out of app/globals.css so the check cannot drift from the
 *  stylesheet -- a table in a markdown file is a promise, and this is the test for it.
 *
 *  Only the .kargah scope is checked. The map and the other CRM surfaces still read the
 *  original :root palette, which this redesign does not touch.
 */
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

/** Pull the custom properties out of one rule block, matched by its exact selector. */
function block(selector) {
  // find the selector at the start of a rule, not inside some other declaration
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.[\]"*+?^${}()|\\]/g, "\\$&")}\\s*\\{`, "m");
  const m = re.exec(CSS);
  if (!m) throw new Error(`no "${selector}" block in app/globals.css`);
  const open = CSS.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  let j = open;
  for (; j < CSS.length; j++) {
    if (CSS[j] === "{") depth++;
    else if (CSS[j] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = CSS.slice(open + 1, j);
  const out = {};
  for (const d of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2];
  return out;
}

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = (hex) => {
  const h = hex.replace("#", "");
  const p = (i) => parseInt(h.slice(i, i + 2), 16);
  return 0.2126 * channel(p(0)) + 0.7152 * channel(p(2)) + 0.0722 * channel(p(4));
};
const ratio = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};

/** Anything a reader must actually read. */
const TEXT = ["--text", "--text-muted", "--accent-text", "--good", "--warn", "--crit", "--info", "--tint-plum"];
/** Non-text: decorative glyphs, disabled day numbers, separators. 3:1 per MASTER.md. */
const NON_TEXT = ["--text-faint"];

const GROUNDS = ["--bg", "--surface"];

let failures = 0;
const say = (ok, line) => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

for (const [theme, selector] of [
  ["light", ".kargah"],
  ["dark", ':root[data-skin="dark"] .kargah'],
]) {
  const t = block(selector);

  for (const [tokens, need] of [
    [TEXT, 4.5],
    [NON_TEXT, 3],
  ]) {
    for (const token of tokens) {
      for (const ground of GROUNDS) {
        if (!t[token] || !t[ground]) {
          say(false, `${theme} ${token} on ${ground}: MISSING from the ${selector} block`);
          continue;
        }
        const r = ratio(t[token], t[ground]);
        say(r >= need, `${theme} ${token} on ${ground}: ${r.toFixed(2)} (need ${need})`);
      }
    }
  }

  // The accent is a FILL in light, so it is its ink that has to pass, not the accent.
  if (t["--accent-ink"] && t["--accent"]) {
    const r = ratio(t["--accent-ink"], t["--accent"]);
    say(r >= 4.5, `${theme} --accent-ink on --accent: ${r.toFixed(2)} (need 4.5)`);
  } else {
    say(false, `${theme}: --accent-ink or --accent missing from the ${selector} block`);
  }

  // Soft-tinted pills carry their status word; the word answers to the pill, not the page.
  for (const [ink, fill] of [
    ["--good", "--good-soft"],
    ["--warn", "--warn-soft"],
    ["--crit", "--crit-soft"],
    ["--info", "--info-soft"],
    ["--accent-text", "--accent-soft"],
  ]) {
    if (!t[ink] || !t[fill]) {
      say(false, `${theme} ${ink} on ${fill}: MISSING`);
      continue;
    }
    const r = ratio(t[ink], t[fill]);
    say(r >= 4.5, `${theme} ${ink} on ${fill}: ${r.toFixed(2)} (need 4.5)`);
  }
}

if (failures) {
  console.error(`\n${failures} contrast failure(s) — see MASTER.md "Color"`);
  process.exit(1);
}
console.log("\nall contrast pairs pass");
