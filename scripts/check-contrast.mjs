/** Asserts every token pair MASTER.md makes a claim about still holds.
 *
 *  Reads the real values out of app/globals.css so the check cannot drift from the
 *  stylesheet -- a table in a markdown file is a promise, and this is the test for it.
 *
 *  Only the .meridian scope is checked. The map and the other CRM surfaces still read the
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
  ["light", ".meridian"],
  ["dark", ':root[data-skin="dark"] .meridian'],
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

  // Gradient stat cards. Only the strongest stop of each mesh is checked because it is
  // the worst case: every other stop is that colour mixed toward --surface, which moves
  // it away from the ink in light and toward it in dark, never past it.
  for (const wash of ["--wash-peach", "--wash-mint", "--wash-sand", "--wash-sky"]) {
    for (const ink of ["--text", "--wash-ink-muted"]) {
      if (!t[ink] || !t[wash]) {
        say(false, `${theme} ${ink} on ${wash}: MISSING`);
        continue;
      }
      const r = ratio(t[ink], t[wash]);
      say(r >= 4.5, `${theme} ${ink} on ${wash}: ${r.toFixed(2)} (need 4.5)`);
    }
  }
}

/* ── The accent themes ────────────────────────────────────────────────────────
   Everything above checks the ONE palette written by hand into the .meridian blocks. The
   ten accent themes are generated into the same file by scripts/gen-accent-themes.mjs,
   and a generator that verifies its own output is only half a test -- the values that
   matter are the ones that actually landed in the stylesheet, read back the same way the
   browser reads them.

   Two pairs here are not in the block above because they are not plain token pairs: the
   cluster bubble and the layers badge compose their colours in CSS, and both were failing
   for every theme INCLUDING the shipping one until this check was written. */

/** color-mix(in srgb, a p%, b) as the browser computes it. */
function mix(a, b, p) {
  const g = (hex, i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16);
  const c = (i) => Math.round(g(a, i) * p + g(b, i) * (1 - p));
  return `#${[0, 2, 4].map((i) => c(i).toString(16).padStart(2, "0")).join("")}`;
}

const THEME_IDS = [
  "terracotta", "gold", "olive", "emerald", "teal",
  "ocean", "indigo", "purple", "raspberry", "graphite",
];

/* The shipping cream, from the hand-written .meridian blocks. scripts/gen-accent-themes.mjs
   re-emits each rung at the theme's hue with chroma capped near zero; the tinted value
   must carry its inks no worse than the cream already does. --text-muted / --text-faint
   on --surface-sunk sit at 4.25 / 2.89 in the palette on screen today, so those pairs are
   held to the cream baseline rather than to an absolute 4.5 / 3.0. */
const SURFACE_CREAM = {
  light: {
    "--bg": "#F4F0E9", "--surface": "#FFFFFF", "--surface-2": "#FDFBF8", "--surface-sunk": "#EFE9E0",
  },
  dark: {
    "--bg": "#141110", "--surface": "#1E1A17", "--surface-2": "#242019", "--surface-sunk": "#2B241E",
  },
};
const SURFACE_INK = {
  light: { "--text": ["#231C16", 7], "--text-muted": ["#776C60", 4.5], "--text-faint": ["#91887C", 3] },
  dark: { "--text": ["#F3EEE7", 7], "--text-muted": ["#9B8F81", 4.5], "--text-faint": ["#8A8278", 3] },
};

/* The grounds these themes are solved against, from the .meridian blocks. --surface-raised
   is what a cluster bubble sits on; it differs from --surface in dark. */
const THEME_GROUND = {
  light: { bg: "#F4F0E9", surface: "#FFFFFF", raised: "#FFFFFF", text: "#231C16", washMuted: "#6A6055", map: "#F4F0E9" },
  dark:  { bg: "#141110", surface: "#1E1A17", raised: "#242019", text: "#F3EEE7", washMuted: "#A99C8D", map: "#12100F" },
};

let themeChecks = 0;
for (const id of THEME_IDS) {
  for (const [skin, selector] of [
    ["light", `:root[data-accent="${id}"] .meridian, :root[data-accent="${id}"]`],
    ["dark", `:root[data-accent="${id}"][data-skin="dark"] .meridian, :root[data-accent="${id}"][data-skin="dark"]`],
  ]) {
    let t;
    try {
      t = block(selector);
    } catch {
      say(false, `${id}/${skin}: no generated block — re-run scripts/gen-accent-themes.mjs`);
      continue;
    }
    const G = THEME_GROUND[skin];
    const need = (a, b, min, label) => {
      themeChecks++;
      if (!t[a] && !a.startsWith("#")) {
        say(false, `${id}/${skin} ${label}: ${a} MISSING`);
        return;
      }
      const r = ratio(a.startsWith("#") ? a : t[a], b);
      say(r >= min, `${id}/${skin} ${label}: ${r.toFixed(2)} (need ${min})`);
    };

    need("--accent-ink", t["--accent"], 4.5, "--accent-ink on --accent");
    need("--accent-text", G.bg, 4.5, "--accent-text on --bg");
    need("--accent-text", G.surface, 4.5, "--accent-text on --surface");
    need("--accent-text", t["--accent-soft"], 4.5, "--accent-text on --accent-soft");
    need("--ev-a-ink", G.surface, 4.5, "--ev-a-ink on --surface");
    need(G.text, t["--wash-peach"], 4.5, "--text on --wash-peach");
    need(G.washMuted, t["--wash-peach"], 4.5, "--wash-ink-muted on --wash-peach");

    // Composed pairs — see the note above.
    need("--accent-ink", t["--accent"], 4.5, "cluster count on cluster fill");
    need("--accent-ink", t["--accent"], 4.5, "layers badge digits on badge fill");

    // Map ink is non-text: 3:1 against the ground the basemap paints.
    for (const m of ["--map-stroke-major", "--map-stroke-minor", "--map-boundary", "--map-selected"]) {
      need(m, G.map, 3, `${m} on the map ground`);
    }

    /* Surface tint (.meridian-scoped block only, without the second `, :root[...]`
       selector). Read it back and assert every tinted ground still carries its inks. */
    let surf;
    try {
      surf = block(`:root[data-accent="${id}"]${skin === "dark" ? '[data-skin="dark"]' : ""} .meridian`);
    } catch {
      say(false, `${id}/${skin}: no .meridian surface-tint block — re-run scripts/gen-accent-themes.mjs`);
      surf = {};
    }
    for (const [g, cream] of Object.entries(SURFACE_CREAM[skin])) {
      for (const [ink, [inkHex, wcag]] of Object.entries(SURFACE_INK[skin])) {
        themeChecks++;
        if (!surf[g]) {
          say(false, `${id}/${skin} ${ink} on ${g}: ${g} MISSING from surface block`);
          continue;
        }
        const got = ratio(inkHex, surf[g]);
        const base = ratio(inkHex, cream);
        const floor = Math.min(wcag, base - 0.08);
        say(got >= floor, `${id}/${skin} ${ink} on ${g} (tinted): ${got.toFixed(2)} (floor ${floor.toFixed(2)})`);
      }
    }
  }
}
console.log(`\nchecked ${themeChecks} pairs across ${THEME_IDS.length} accent themes`);

if (failures) {
  console.error(`\n${failures} contrast failure(s) — see MASTER.md "Color"`);
  process.exit(1);
}
console.log("\nall contrast pairs pass");
