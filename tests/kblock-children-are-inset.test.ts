import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Nothing inside a card runs flush to the card's edge.
 *
 *  `.kblock` itself has no padding — it cannot have any, because `.bhead` draws its own
 *  full-bleed header. The inset lives on `.kblock__body`, so a direct child that forgets
 *  it touches the card edge and its Persian text bleeds into the shadow.
 *
 *  The user reported this once, on one paragraph. It was on eight elements across seven
 *  files, including two whole tables — the `/sales/deliveries` table the user separately
 *  reported as "text outside the card", and the identical one on `/sales/reps` that
 *  nobody had reported at all. Four more call sites had hand-rolled the inset as
 *  `padding: "0 22px 20px"` or `px-[var(--space-4)]`, each a different number, none of
 *  them tracking `.kblock__body` when it changes.
 *
 *  So the rule is structural, not visual: a direct child of `.kblock` either carries
 *  `.kblock__body`, or is one of the named classes below that supplies its own inset.
 */
const ROOT = join(__dirname, "..");

/** Classes whose own CSS rule already sets a horizontal inset, verified below so that a
 *  later edit removing that padding cannot silently widen this exemption. */
const SELF_INSET: Record<string, string> = {
  bhead: ".meridian .bhead { padding: 20px 24px 14px; }  — the card's own header",
  hint: ".meridian .hint { padding: 0 24px 18px; }",
  board: ".meridian .board { padding: 6px 16px 24px; }",
  cal: ".meridian .cal { padding: 6px 22px 22px; }",
  rail: ".meridian .rail { padding: 6px 22px 22px; }",
};

/** Components whose own root element already answers for the inset. Named individually
 *  with the reason: an unnamed escape hatch is how the eight offenders above stayed
 *  invisible for as long as they did. */
const SELF_INSET_COMPONENTS: Record<string, string> = {
  CustomerSheet: "a fixed overlay — the card's inset does not apply to it at all",
  OrderPipeline: "renders `.board`, which is exempt above for its own padding",
};

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".tsx")) out.push(child);
    }
  };
  walk("app");
  walk("components");
  return out.sort();
}

/** Direct children of every `className="kblock"` element in a file.
 *
 *  Indentation, not a JSX parser: this repo is prettier-shaped, every `.kblock` in it is
 *  written across multiple lines, and a child of a card sits exactly two columns in. A
 *  closing tag is not a child, which is the one thing a naive version of this gets wrong.
 */
function kblockChildren(src: string): { line: number; text: string }[] {
  const lines = src.split("\n");
  const kids: { line: number; text: string }[] = [];
  lines.forEach((l, i) => {
    if (!/className=\{?["'`]kblock[ "'`]/.test(l)) return;
    /* A `.kblock` with no `.bhead` may pay the inset itself — `/sales/reps/[id]` is one
       card with padding on the card, not a header over a padded body. Its children are
       already inset by definition, so it has no direct children to police. */
    if (/\bp-\[|\bpx-\[|padding/.test(l)) return;
    const indent = l.length - l.trimStart().length;
    for (let j = i + 1; j < lines.length; j++) {
      const s = lines[j];
      if (!s.trim()) continue;
      const k = s.length - s.trimStart().length;
      if (k <= indent) break;
      const t = s.trimStart();
      if (k === indent + 2 && t.startsWith("<") && !t.startsWith("</")) {
        kids.push({ line: j + 1, text: t });
      }
    }
  });
  return kids;
}

function isInset(text: string): boolean {
  if (/\bkblock__body\b/.test(text)) return true;
  for (const cls of Object.keys(SELF_INSET)) {
    if (new RegExp(`className=\\{?["'\`][^"'\`]*\\b${cls}\\b`).test(text)) return true;
  }
  const tag = text.match(/^<([A-Z]\w*)/)?.[1];
  return tag !== undefined && tag in SELF_INSET_COMPONENTS;
}

describe("card content keeps the card's inset", () => {
  it("every direct child of .kblock is inset", () => {
    const offenders: string[] = [];
    for (const f of tsxFiles()) {
      for (const kid of kblockChildren(readFileSync(join(ROOT, f), "utf8"))) {
        if (!isInset(kid.text)) offenders.push(`${f}:${kid.line}  ${kid.text.slice(0, 70)}`);
      }
    }
    expect(
      offenders,
      `wrap these in <div className="kblock__body"> — do not hand-roll the padding:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the exempt classes still carry their own inset", () => {
    /* Each exemption above is a promise that some other rule pays the inset. If that rule
       loses its padding, the exemption becomes a hole rather than a delegation. */
    const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
    for (const cls of Object.keys(SELF_INSET)) {
      const rule = new RegExp(`\\.meridian \\.${cls}\\s*\\{[^}]*padding:`);
      expect(rule.test(css), `.${cls} no longer sets padding — ${SELF_INSET[cls]}`).toBe(true);
    }
  });

  it(".kblock__body is the one place the inset is defined", () => {
    const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.meridian \.kblock__body\s*\{[^}]*padding:/);
  });

  it("finds the cards it is meant to police", () => {
    /* If the matcher above ever stops recognising `.kblock`, every file passes and this
       test reports success over an unchecked tree. Eighteen cards exist today. */
    const total = tsxFiles().reduce(
      (n, f) => n + kblockChildren(readFileSync(join(ROOT, f), "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(20);
  });
});
