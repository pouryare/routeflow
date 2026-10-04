import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return walk(rel);
    return rel.endsWith(".tsx") ? [rel] : [];
  });
}

/**
 * The full source of the element opening at `start`, through its closing `>`.
 *
 * Written as an explicit lexer because four separate false-positive classes came out of
 * getting it subtly wrong, and each one made the scan report a button as unreadable when a
 * Persian reader can plainly read it:
 *
 *  1. **String literals.** `className={`tf-opt${approx ? " on" : ""}`}` contains `}`
 *     characters that are not JSX braces.
 *  2. **Arrow functions.** `onClick={() => setOpen((v) => !v)}` contains a bare `>` that
 *     is an ARROW, not a tag terminator — stopping there truncated the element to 39
 *     characters and hid the label inside it.
 *  3. **Self-closing children.** `<Icon … />` ends with `/>`; a naive first-`>` scan reports
 *     every icon-bearing button as iconless.
 *  4. **Nested elements.** `{a ? <b>x</b> : <i>y</i>}` nests tags inside the button.
 *
 * The rule: while inside a tag, braces count (so an arrow's `>` is ignored) and a `>` at
 * brace depth zero closes the TAG; once the tag closes, the next `>` at depth zero closes
 * the ELEMENT.
 */
function elementBody(src: string, start: number): string {
  // Phase 1 — consume the opening tag.
  let j = start + 1;
  let depth = 0;
  let quote: string | null = null;
  let tagClosed = false;
  for (; j < src.length - 1; j += 1) {
    const c = src[j];
    if (quote) {
      if (c === "\\") j += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") {
      depth += 1;
      continue;
    }
    if (c === "}") {
      depth -= 1;
      continue;
    }
    if (c === ">" && depth === 0) {
      tagClosed = true;
      break;
    }
  }
  if (!tagClosed) return src.slice(start, start + 600);

  // Phase 2 — consume children until the element's own closing `>`.
  //
  // Nesting is counted, not guessed. A first version treated ANY `</…>` as this element's
  // end, so a button containing `<span>…</span>` was truncated at the span's close and the
  // label inside it was never seen. `nest` rises on a nested opening tag and falls on its
  // matching close; only a close at nest 0 ends us.
  quote = null;
  let nest = 0;
  for (; j < src.length - 1; j += 1) {
    const c = src[j];
    if (quote) {
      if (c === "\\") j += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "<") {
      if (src[j + 1] === "/") {
        // A closing tag. At nesting 0 it is OUR end; deeper, it closes a child.
        if (nest === 0) {
          const close = src.indexOf(">", j);
          return src.slice(start, close === -1 ? j : close + 1);
        }
        nest -= 1;
        j = src.indexOf(">", j);
        continue;
      }
      // An opening tag: skip its attributes so a `/>` inside cannot read as our terminator.
      let k = j + 1;
      let q: string | null = null;
      while (k < src.length - 1) {
        const kc = src[k];
        if (q) {
          if (kc === "\\") k += 1;
          else if (kc === q) q = null;
        } else if (kc === '"' || kc === "'" || kc === "`") q = kc;
        else if (kc === ">") break;
        k += 1;
      }
      const selfClosing = src[k - 1] === "/";
      if (!selfClosing) nest += 1;
      j = k;
      continue;
    }
    if (c === "{" && src[j + 1] !== "}") {
      let k = j + 1;
      let d = 1;
      while (k < src.length - 1 && d > 0) {
        if (src[k] === "{") d += 1;
        else if (src[k] === "}") d -= 1;
        k += 1;
      }
      j = k - 1;
      continue;
    }
  }
  return src.slice(start, j + 1);
}

/** The CONTENT of an element — between its opening tag's `>` and its matching `</`.
 *
 *  The opening tag must be skipped with brace awareness, or `onClick={() => setOpen(v)}`
 *  ends the "content" at the arrow and everything after it is invisible. */
function elementContent(src: string, start: number, end: number): string {
  // Skip the OPENING TAG first. Slicing from `start + 1` kept `className="h-5 w-5"` and
  // `onClick={() => setOpen(…)}` in the "content", so an icon-only checkbox passed as
  // labelled on the strength of its own className.
  const openEnd = elementTag(src, start).length;
  // Then drop the trailing `</button>`.
  return src.slice(start + openEnd, Math.max(start + openEnd, end - "</button>".length));
}

/** Is this human-readable text a reader would actually be given?
 *
 *  The distinguishing question is NOT "is it a literal?" — it is **does the expression render
 *  TEXT or an ELEMENT?** React renders `{c.business_name}` as text and a screen reader
 *  announces the business name, so that IS a label. But `{isChecked ? <Icon … /> : null}`
 *  renders a glyph, which is not a name.
 *
 *  So: an expression counts as text unless it contains a JSX tag. That single distinction
 *  separates every shape in this codebase correctly —
 *
 *    `{c.business_name}`                            → text     → named
 *    `{loading ? "در حال ورود..." : "ورود"}`         → text     → named
 *    `{busy ? busyLabel : idleLabel}`               → text     → named
 *    `{isChecked ? <Icon name="check"/> : null}`     → element  → NOT named
 *
 *  An earlier version of this rule rejected bare identifiers as unreadable, on the theory
 *  that a developer-only name tells a user nothing. That was wrong and it flagged 49 real
 *  buttons, including plainly readable ones: what is on screen is the value, not the
 *  variable name. */
function hasTextContent(content: string): boolean {
  // Fragments (`<>` … `</>`) are TRANSPARENT — their children render. Real tags are opaque.
  let t = content.replace(/<\/?>/g, " ").replace(/<[^>]*>/g, "\u0001");

  // Does this fragment of source put visible characters on screen?
  const renders = (frag: string): boolean =>
    /[\p{L}\p{N}]/u.test(frag.replace(/\u0001/g, "").replace(/\s+/g, " "));

  t = t.replace(/\{([^{}]*)\}/g, (_m, expr: string) => {
    // A ternary's CONDITION never renders — only its branches do. Judging the whole
    // expression instead made `{selectAll ? <Icon/> : null}` count as text, because
    // `selectAll` is a word, and that hid an icon-only checkbox from the scan.
    const q = expr.indexOf("?");
    const branches = q === -1 ? [expr] : expr.slice(q + 1).split(/\?|:(?![:=])/);
    for (const b of branches) {
      const p = b.replace(/["'`]/g, " ").trim();
      // Literals that render nothing.
      if (!p || /^(null|undefined|true|false|\.\.\.)$/.test(p)) continue;
      if (renders(p)) return "0";
    }
    return "";
  });

  return /[\p{L}\p{N}]/u.test(t.replace(/\u0001/g, "").replace(/\s+/g, " "));
}

/** Blank comments in place, spanning blocks. ToastProvider documents the banned glyphs in a
 *  block comment, and a line-at-a-time stripper flags the explanation as the offence. */
function blankComments(src: string): string {
  const out = src.split("\n");
  let inBlock = false;
  return out
    .map((line) => {
      let l = line;
      if (inBlock) {
        const end = l.indexOf("*/");
        if (end === -1) return "";
        l = l.slice(end + 2);
        inBlock = false;
      }
      const start = l.indexOf("/*");
      if (start !== -1) {
        const end = l.indexOf("*/", start + 2);
        if (end === -1) {
          inBlock = true;
          return l.slice(0, start);
        }
        l = l.slice(0, start) + " " + l.slice(end + 2);
      }
      return l.replace(/^\s*\/\/.*$/, "");
    })
    .join("\n");
}

export interface Offender {
  file: string;
  line: number;
  reason: "no icon, no accessible name" | "icon but no accessible name";
}

/** The opening TAG of an element — its attributes, with no body. */
function elementTag(src: string, start: number): string {
  let quote: string | null = null;
  let depth = 0;
  for (let j = start; j < src.length - 1; j += 1) {
    const c = src[j];
    if (quote) {
      if (c === "\\") j += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    // Braces matter here too. `onClick={() => setOpen((v) => !v)}` contains a `>` that is an
    // ARROW, not the end of the tag. Without counting braces the scan stopped there and
    // never reached the aria-label further along the same tag — reporting a button that is
    // plainly named as nameless.
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return src.slice(start, j + 1);
  }
  return src.slice(start, start + 400);
}

/** Every `<button>` that carries neither an `<Icon>` nor an accessible name.
 *
 *  The rule has two halves because they protect different readers. A visible Persian label
 *  already names a button for a screen reader, so a button with `<Icon>` OR visible text is
 *  fine. What is never fine is a button that is BOTH iconless AND nameless: invisible to a
 *  screen reader, and an unlabelled shape on screen. */
export function offendersIn(src: string): Offender[] {
  const clean = blankComments(src);
  const out: Offender[] = [];
  for (const m of clean.matchAll(/<button\b/gi)) {
    const body = elementBody(clean, m.index);
    const line = clean.slice(0, m.index).split("\n").length;
    const tag = elementTag(clean, m.index);
    const content = elementContent(clean, m.index, m.index + body.length);
    const hasIcon = /<Icon\b/.test(body);
    // Attributes are read from the TAG, not from the body: `aria-label="…"` is quoted, and a
    // body scan that skips string literals skips the accessible name it is looking for.
    const named =
      /\baria-label=/.test(tag) ||
      /\baria-labelledby=/.test(tag) ||
      /\btitle=/.test(tag) ||
      // Does the element's CONTENT carry human-readable text?
      //
      // Mechanical, not a regex over the raw body. Five regex attempts each failed in a
      // different direction — one reported every button as iconless, one reported nothing at
      // all because it matched `onClick={() => …}`, and one flagged twelve perfectly
      // readable Persian buttons. The order below is what makes each shape come out right.
      hasTextContent(content)
    if (!hasIcon && !named) out.push({ file: "", line, reason: "no icon, no accessible name" });
    else if (hasIcon && !named && body.indexOf("<Icon") !== -1) {
      const iconTag = body.match(/<Icon\b[^>]*\/>/g)?.join(" ") ?? "";
      if (!/label=/.test(iconTag)) {
        out.push({ file: "", line, reason: "icon but no accessible name" });
      }
    }
  }
  return out;
}

describe("every button is findable", () => {
  it("finds the buttons at all (guards the extractor itself)", () => {
    // If this fails the element scanner is broken and every other result is noise.
    const src = read("components/SearchBox.tsx");
    expect((src.match(/<button\b/gi) ?? []).length).toBeGreaterThan(5);
    expect(elementBody('x<button a={1}>hi</button>', 1)).toContain("hi");
  });

  it("does not end the element at the arrow inside an onClick attribute", () => {
    // `onClick={() => setOpen((v) => !v)}` — the `>` is an ARROW. Closing there truncated
    // the body to 51 characters and hid the Persian label inside it, so a clearly readable
    // collapsible heading was reported as nameless.
    const el =
      '<button\n  onClick={() => setOpen((v) => !v)}\n  className="x"\n>\n  <span>تاریخچه</span>\n</button>';
    const body = elementBody(el, 0);
    expect(body).toBe(el);
    expect(body).toContain("تاریخچه");
  });

  it("sees an icon inside a self-closing tag", () => {
    // The regression that made the first sweep report 0 of 361: `/>` is not the end of the
    // element, and stopping there hides every icon in the button.
    const el = '<button type="button"><Icon name="plus" size="sm" /></button>';
    expect(elementBody(el, 0)).toBe(el);
  });

  it("survives a template literal containing braces in an attribute", () => {
    // The false positive that made this gate report a readable Persian button as nameless:
    // `className={`tf-opt${approx ? " on" : ""}`}` has `}` inside a string, which drove the
    // depth negative and closed the element mid-attribute.
    const el =
      '<button type="button" className={`tf-opt${approx ? " on" : ""}`} onClick={f}>\n' +
      "          آدرس تقریبی است\n" +
      "          <small>توضیح</small>\n" +
      "        </button>";
    expect(elementBody(el, 0)).toBe(el);
    expect(elementBody(el, 0)).toContain("آدرس تقریبی است");
  });

  it("does not stop at the arrow of onClick={() => …}", () => {
    const el =
      '<button\n  type="button"\n  onClick={() => setOpen((v) => !v)}\n  aria-label="رنگ ظاهر"\n>x</button>';
    const tag = elementTag(el, 0);
    expect(tag).toContain('aria-label="رنگ ظاهر"');
    expect(tag.endsWith(">")).toBe(true);
  });

  it("counts a Persian ternary as a label", () => {
    expect(
      offendersIn('<button onClick={f}>{loading ? "در حال ورود..." : "ورود"}</button>'),
    ).toHaveLength(0);
    expect(
      offendersIn(
        '<button onClick={f}>{m.kind === "phone" ? "شماره را اصلاح کنم" : "صفحه را اصلاح کنم"}</button>',
      ),
    ).toHaveLength(0);
  });

  it("catches an icon-only checkbox with no accessible name", () => {
    // The genuine find: a 20x20 checkbox whose entire content is a conditional <Icon>.
    // To a screen reader it is an unnamed control.
    const el =
      '<button\n  type="button"\n  onClick={(e) => toggle(e, id)}\n  className="h-5 w-5"\n>\n  {checked ? <Icon name="check" size="sm" /> : null}\n</button>';
    expect(offendersIn(el)).toHaveLength(1);
    expect(offendersIn(el)[0].reason).toBe("icon but no accessible name");
  });

  it("sees text wrapped in a fragment", () => {
    // `<>موقعیت من <Icon name="check"/></>` — the fragment is transparent, so its Persian
    // text counts. Treating `<…>` as an opaque tag hid the label on three buttons.
    const el =
      '<button onClick={f}>{loading ? "در حال…" : <>موقعیت من <Icon name="check" /></>}</button>';
    expect(offendersIn(el)).toHaveLength(0);
  });

  it("does not read a ternary condition as a label", () => {
    // `selectAll` is a word but never renders; only the branches do.
    const el = '<button onClick={f}>{selectAll ? <Icon name="check" /> : null}</button>';
    expect(offendersIn(el)).toHaveLength(1);
  });

  it("counts a variable-rendered label as text, because that is what renders", () => {
    // React renders `{c.business_name}` as the name itself; a screen reader announces it.
    expect(offendersIn("<button onClick={f}>{c.business_name}</button>")).toHaveLength(0);
    expect(offendersIn("<button onClick={f}>{s}</button>")).toHaveLength(0);
    expect(offendersIn("<button onClick={f}>{busy ? busyLabel : idleLabel}</button>")).toHaveLength(0);
  });

  it("does not count an expression that renders an element", () => {
    // The same expression, but choosing a glyph rather than a name.
    expect(offendersIn("<button onClick={f}>{sel ? <Icon name=\"check\" /> : null}</button>")).toHaveLength(1);
  });

  it("is not silenced by an ordinary event handler", () => {
    // The negative control. If an onClick expression counted as a "label", every button in
    // the app would pass and the gate would be decorative.
    const el = '<button onClick={() => setOpen((v) => !v)} className="x"></button>';
    expect(offendersIn(el)).toHaveLength(1);
  });

  it("counts a Persian string inside an expression as a label", () => {
    const el = '<button onClick={f}>{origin ? origin.label : "تعیین نشده"}</button>';
    expect(offendersIn(el)).toHaveLength(0);
  });

  it("counts an aria-label as a label", () => {
    const el = '<button aria-label="بستن پنل" aria-expanded={x} onClick={() => f()} />';
    expect(offendersIn(el)).toHaveLength(0);
  });

  it("reads an accessible name out of a quoted attribute", () => {
    const el =
      '<button type="button" aria-haspopup="true" aria-label="رنگ ظاهر برنامه" title="رنگ">x</button>';
    expect(elementTag(el, 0)).toContain('aria-label="رنگ ظاهر برنامه"');
  });

  it("does not mistake a nested conditional for the end of the element", () => {
    const el = '<button>{a ? <b>x</b> : <i>y</i>}</button>';
    expect(elementBody(el, 0)).toBe(el);
  });
});

describe("every button a reader can identify", () => {
  it("no button is both iconless and nameless", () => {
    const all: string[] = [];
    for (const f of [...walk("app"), ...walk("components")]) {
      for (const o of offendersIn(read(f))) all.push(`${f}:${o.line}  ${o.reason}`);
    }
    expect(
      all,
      `Give each of these an <Icon> or an accessible name:\n${all.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Files where EVERY iconless button is allowed, because an icon there is noise rather than a
 * label. Pre-dates the in-place-comment rule below, which is the preferred way to record a
 * reason: next to the button, where the next person to change it will actually read it.
 *
 *  - `gallery/page.tsx` — the button IS a photo. The image is the content; a camera glyph
 *    beside it says nothing the picture does not.
 *  - `JalaliDatePicker` — a calendar DAY CELL. It is a cell in a grid, not an action. Every
 *    one of the 31 has the same glyph; an icon repeated 31 times is decoration.
 */
const ALLOWED_ICONLESS = [
  "app/(shell)/gallery/page.tsx",
  "components/JalaliDatePicker.tsx",
];

/** A recorded reason, written as a comment INSIDE the button.
 *
 *  This is the rule the house style already follows and the test could not see: a button that is
 *  deliberately iconless carries a comment saying why, right where it happens. AccentPicker,
 *  FontPicker and ProfileMenu all do it — «No tick on the selected option…», «No person glyph
 *  beside the picture. The Avatar IS the person…» — and all three were being reported anyway,
 *  because the check only knew about a file-level list kept a few hundred lines away.
 *
 *  Forty characters is a floor, not a rule: `{* *}` or `{/* todo *\/}` is not a reason, and
 *  counting to forty is enough to tell one from the other. The friction this test wants is
 *  "write down why", not "write why well" — a second opinion on the wording is a reviewer's
 *  job, not a test's. */
const RECORDED_REASON = /\{\/\*[\s\S]{40,}?\*\/\}/;

describe("every button carries an icon", () => {
  it("no button is iconless without a recorded reason", () => {
    const all: string[] = [];
    for (const f of [...walk("app"), ...walk("components")]) {
      if (ALLOWED_ICONLESS.includes(f.split(path.sep).join("/"))) continue;
      const src = read(f);
      for (let i = src.indexOf("<button"); i !== -1; i = src.indexOf("<button", i + 1)) {
        const body = elementBody(src, i);
        if (!body) continue;
        const content = elementContent(src, i, src.indexOf(">", i) + 1 + body.length);
        // a button that IS its own picture, or renders one, is not iconless
        if (/<Icon\b/.test(content) || /<svg\b/.test(content)) continue;
        if (/<img\b/.test(content)) continue;
        // …and a button that says out loud why it needs no picture is not unconsidered.
        if (RECORDED_REASON.test(content)) continue;
        const line = src.slice(0, i).split("\n").length;
        all.push(`${f}:${line}`);
      }
    }
    expect(
      all,
      `Add an <Icon name="…" /> to these, or record why not in a comment inside the button:\n${all.join("\n")}`,
    ).toEqual([]);
  });
});
