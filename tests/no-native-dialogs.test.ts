import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** No browser prompt(), confirm() or alert().
 *
 *  The browser draws those itself: the buttons say OK and Cancel (or whatever the browser's
 *  language makes of them), a prompt shows a typed password in the clear, and a date can only
 *  be typed by hand. A screen that has to ask must ask in the page, with buttons that say what
 *  they do («حذف همیشگی گروه «X»», «انصراف از حذف گروه»).
 */
const ROOT = join(__dirname, "..");

function sources(rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(child));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(child);
  }
  return out;
}

const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// `window.confirm(` or a bare call; a function the file defines itself («async function confirm() {»)
// is not the browser's.
const NATIVE = /\bwindow\.(prompt|confirm|alert)\s*\(|(?<![.\w])(?<!function\s+)(prompt|confirm|alert)\s*\(/;

describe("native dialogs", () => {
  const files = ["app", "components"].flatMap(sources);

  it("finds the source tree (guards the walker)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("nothing asks with a browser dialog", () => {
    const hits: string[] = [];
    for (const f of files) {
      withoutComments(readFileSync(join(ROOT, f), "utf8")).split("\n").forEach((line, i) => {
        if (NATIVE.test(line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the pattern recognises a native dialog (guards the pattern)", () => {
    expect(NATIVE.test('if (!window.confirm("x")) return;')).toBe(true);
    expect(NATIVE.test('const v = window.prompt("x");')).toBe(true);
    expect(NATIVE.test("const asking = await confirmOrder();")).toBe(false);
    expect(NATIVE.test("async function confirm() {")).toBe(false);
    expect(NATIVE.test("if (!confirm('x')) return;")).toBe(true);
  });
});
