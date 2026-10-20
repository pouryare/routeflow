import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Every action says what it acts on.
 *
 *  «بستن», «لغو», «حذف», «ذخیره» alone tell a first-day user nothing about what will close,
 *  cancel, vanish or be saved — and «لغو» alone meant dismiss, cancel and undo in different
 *  places. Labels are verb + object: «بستن رسید», «انصراف از تخلیه», «حذف این کار».
 *
 *  The scan reads button and link labels (text between a tag and its closing tag, after any
 *  icon) and toast action labels. A bare word is allowed only in the exemption list, each
 *  with a reason.
 */
const ROOT = join(__dirname, "..");

const BARE = [
  "بستن", "لغو", "انصراف", "حذف", "ذخیره", "ویرایش", "ادامه", "افزودن", "ثبت",
  "بعدی", "قبلی", "تأیید", "تکمیل", "ایجاد", "بله", "خیر", "بعداً", "بازگشت", "نقشه",
];

/** file → reason. Keep this empty unless a bare word is genuinely unambiguous. */
const EXEMPT: Record<string, string> = {};

function sources(rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(child));
    else if (e.name.endsWith(".tsx")) out.push(child);
  }
  return out;
}

const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const WORDS = BARE.join("|");
// `/>` or `>` then optional space, the bare word, then the closing tag of a button or link.
const JSX_LABEL = new RegExp(`(?:\\/>|>)\\s*(${WORDS})\\s*<\\/(?:button|a|Link)>`, "g");
// toast(..., { label: "لغو", onClick })
const TOAST_ACTION = new RegExp(`label:\\s*["'](${WORDS})["']`, "g");

/** Tap-flow answers are defined in lib/crm/flows/*.ts as `label: "…"`, not in JSX. */
function flowSources(): string[] {
  return readdirSync(join(ROOT, "lib/crm/flows")).filter((n) => n.endsWith(".ts")).map((n) => `lib/crm/flows/${n}`);
}

describe("action labels", () => {
  const files = [...["app", "components"].flatMap(sources).filter((f) => !f.startsWith("app/api")), ...flowSources()];

  it("finds the source tree (guards the walker)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no button, link or toast action is a bare verb", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (EXEMPT[f]) continue;
      const src = withoutComments(readFileSync(join(ROOT, f), "utf8"));
      for (const re of [JSX_LABEL, TOAST_ACTION]) {
        for (const m of src.matchAll(re)) {
          const line = src.slice(0, m.index).split("\n").length;
          hits.push(`${f}:${line}  «${m[1]}» — add what it acts on`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the scan recognises a bare label (guards the pattern)", () => {
    expect(new RegExp(JSX_LABEL.source).test('<Icon name="x" />\n  بستن\n</button>')).toBe(true);
    expect(new RegExp(JSX_LABEL.source).test("<Icon />\n  بستن رسید\n</button>")).toBe(false);
    expect(new RegExp(TOAST_ACTION.source).test('{ label: "لغو", onClick }')).toBe(true);
    expect(new RegExp(TOAST_ACTION.source).test('{ label: "بازگردانی ثبت", onClick }')).toBe(false);
  });
});
