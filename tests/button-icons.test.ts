import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ICONS } from "@/components/meridian/icon-map";

/** Every action button wears an icon, and one action wears one icon across the app.
 *
 *  Two checks, both decided by the owner on 2026-10-28:
 *   1. A button (`<button>`, HeroUI `<Button>`, or a link styled `.btn`) with no `<Icon>`,
 *      `<BusyIcon>` or own `<svg>` fails, unless it is listed in EXEMPT with a reason.
 *   2. A button whose label starts with a known verb must name that verb's icon. The
 *      dictionary below IS the app's action vocabulary: change it here, not per screen.
 *
 *  Parsed with the TypeScript compiler rather than regexes: button-a11y.test.ts documents
 *  how many ways a hand-written JSX scanner goes wrong. */

const root = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return walk(rel);
    return rel.endsWith(".tsx") ? [rel] : [];
  });
}

/** Label start → the icon it must wear. First match wins, so narrow rules come first. */
const ACTION_ICONS: [RegExp, string][] = [
  [/^ذخیره کردم/, "check"],
  [/^ذخیره/, "save"],
  [/^حذف از (مسیر|برنامه|روز)/, "minus"],
  [/^حذف .+ از (مسیر|روز)/, "minus"],
  [/^حذف اولویت/, "flag"],
  [/^حذف/, "trash"],
  [/^(انصراف|لغو|بستن)/, "x"],
  [/^پاک کردن یک رقم/, "backspace"],
  [/^پاک کردن/, "x"],
  [/^ویرایش/, "edit"],
  [/^چاپ/, "print"],
  [/^خروجی/, "download"],
  [/^(کپی|.* کپی شد$)/, "copy"],
  [/^چسباندن/, "paste"],
  [/^ارسال/, "send"],
  [/^(تلاش|بارگذاری|بررسی) دوباره/, "refresh"],
  [/^بارگذاری عکس/, "upload"],
  [/^تماس/, "phone"],
  [/^مسیریابی/, "navigation"],
  [/^خروج/, "logout"],
  [/^(تأیید و )?ورود/, "login"],
  [/^بازگشت به(?! ویرایش)/, "arrow-right"],
  [/^افزودن.*به برنامه/, "calendar-plus"],
  [/^افزودن (رسید|عکس)/, "camera"],
  [/^افزودن/, "plus"],
  [/^یادآوری/, "alarm"],
  [/^تأیید/, "check"],
  [/^جستجو/, "search"],
  [/^فیلتر/, "filter"],
];

/** Buttons that are their own content, or draw their own glyph. Each needs a reason. */
const EXEMPT: { file: string; match: string; reason: string }[] = [
  { file: "components/mobile/Keypad.tsx", match: "keypad__key", reason: "a keypad digit is the content" },
  { file: "components/mobile/MonthGrid.tsx", match: "monthgrid__day", reason: "a calendar day is the content" },
  { file: "components/AccentPicker.tsx", match: "", reason: "the colour swatch is the icon" },
  { file: "components/FontPicker.tsx", match: "", reason: "the «آ» sample in the font is the icon" },
  { file: "app/(shell)/gallery/page.tsx", match: "group flex flex-col overflow-hidden", reason: "a photo thumbnail is the content" },
  { file: "components/PhotoGallery.tsx", match: "aspect-square", reason: "a photo thumbnail is the content" },
  { file: "app/(shell)/sales/admin/users/page.tsx", match: "cursor-pointer overflow-hidden rounded-lg", reason: "a photo thumbnail is the content" },
  { file: "components/mobile/KpiCarousel.tsx", match: "kpicarousel__card", reason: "a KPI card is the content" },
  { file: "components/meridian/ProfileMenu.tsx", match: "pm__trigger", reason: "the person's avatar is the icon" },
  { file: "components/facilities/PlacePicker.tsx", match: "flex min-h-11 w-full items-center", reason: "a place row; the whole row is the tap target" },
  { file: "app/(shell)/accounting/income-statement/page.tsx", match: "/accounting/income-statement", reason: "a period filter chip; the period is the content" },
  { file: "app/(shell)/accounting/journal/page.tsx", match: "\"period\")", reason: "a period filter chip; the period is the content" },
  { file: "app/(shell)/report/page.tsx", match: "href=\"/report", reason: "a sort-order chip; the order is the content" },
  { file: "app/(shell)/sales/reasons/page.tsx", match: "/sales/reasons?days=", reason: "a date-range chip; the range is the content" },
  { file: "app/(shell)/sales/data-quality/page.tsx", match: "/crm/${r.id}", reason: "a customer row; the whole card is the tap target" },
  { file: "components/mobile/HoldButton.tsx", match: "", reason: "the hold progress ring is the icon" },
  { file: "components/LeadsMap.tsx", match: "lead-marker", reason: "the button is the map pin itself, a dot or its stop number" },
  { file: "components/PlannerPickMap.tsx", match: "lead-marker", reason: "the button is the map pin itself, a dot or its stop number" },
  { file: "components/coverage/CustomerLayer.tsx", match: "min-h-[44px] w-full", reason: "a customer row; its coloured diamond is the pin in miniature" },
  { file: "components/tapflow/Answer.tsx", match: "", reason: "AnswerButton's icon is a prop; answers are content, so it is optional" },
];

type Found = { file: string; line: number; src: string; label: string; icon: boolean; kind: "own" | "wrap"; iconProp?: string };

const WRAPPER_DEFAULT: Record<string, string> = { GoButton: "check", SkipButton: "arrow-left", StickyAction: "check" };

function scan(file: string): Found[] {
  const text = readFileSync(path.join(root, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Found[] = [];
  const attr = (o: ts.JsxOpeningLikeElement, name: string) => {
    for (const a of o.attributes.properties) {
      if (ts.isJsxAttribute(a) && a.name.getText(sf) === name) return a.initializer;
    }
    return undefined;
  };
  /** A template's text with each `${…}` read as «…», so `حذف ${name} از مسیر` keeps its tail. */
  const template = (e: ts.TemplateExpression) => e.head.text + e.templateSpans.map((x) => "…" + x.literal.text).join("");
  const literal = (init: ts.JsxAttributeValue | undefined): string => {
    if (!init) return "";
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
      if (ts.isTemplateExpression(e)) return template(e);
      if (ts.isConditionalExpression(e) && ts.isStringLiteral(e.whenTrue)) return e.whenTrue.text;
    }
    return "";
  };
  /** The first Persian words the element shows, skipping «در حال …» busy text. */
  const visible = (n: ts.Node): string => {
    let found = "";
    const visit = (c: ts.Node) => {
      if (found || ts.isJsxAttributes(c)) return;
      let t = "";
      if (ts.isJsxText(c)) t = c.text;
      else if (ts.isStringLiteral(c) || ts.isNoSubstitutionTemplateLiteral(c)) t = c.text;
      else if (ts.isTemplateExpression(c)) t = template(c);
      t = t.replace(/\s+/g, " ").replace(/^[\s+＋]+/, "").trim();
      if (/[؀-ۿ]/.test(t) && !/^در حال/.test(t)) {
        found = t;
        return;
      }
      ts.forEachChild(c, visit);
    };
    ts.forEachChild(n, visit);
    return found;
  };
  const visit = (node: ts.Node) => {
    const o = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (o) {
      const tag = o.tagName.getText(sf);
      const cls = literal(attr(o, "className")) + (attr(o, "className")?.getText(sf) ?? "");
      /* A link is a button when it is drawn as one: `.btn`, or a bordered rounded box. */
      const linkButton = (tag === "a" || tag === "Link") && (/\bbtn\b/.test(cls) || (/\brounded/.test(cls) && /\bborder\b/.test(cls)));
      const own = tag === "button" || tag === "Button" || linkButton;
      const wrap = tag in WRAPPER_DEFAULT;
      if (own || wrap) {
        const src = node.getText(sf);
        const label = visible(node) || literal(attr(o, "label")) || literal(attr(o, "aria-label"));
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(o.getStart()).line + 1,
          src,
          label,
          icon: /<(Icon|BusyIcon|svg)\b/.test(src) || /dangerouslySetInnerHTML/.test(src),
          kind: own ? "own" : "wrap",
          iconProp: wrap ? literal(attr(o, "icon")) || WRAPPER_DEFAULT[tag] : undefined,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const all = [...walk("app"), ...walk("components")].flatMap(scan);

describe("every action button has a fitting icon", () => {
  it("finds the buttons at all", () => {
    expect(all.length).toBeGreaterThan(400);
  });

  it("gives every button an icon, or a written reason", () => {
    const exemptUsed = new Set<number>();
    const missing = all
      .filter((b) => b.kind === "own" && !b.icon)
      .filter((b) => {
        const i = EXEMPT.findIndex((e) => e.file === b.file && b.src.includes(e.match));
        if (i === -1) return true;
        exemptUsed.add(i);
        return false;
      })
      .map((b) => `${b.file}:${b.line} «${b.label}»`);
    expect(missing, "add an <Icon> from components/meridian/icon-map.ts").toEqual([]);
    const stale = EXEMPT.filter((_e, i) => !exemptUsed.has(i));
    expect(stale.map((e) => `${e.file} (${e.match})`), "EXEMPT entry no longer matches a button").toEqual([]);
  });

  it("wears the dictionary's icon for a known verb", () => {
    const wrong: string[] = [];
    for (const b of all) {
      const rule = ACTION_ICONS.find(([re]) => re.test(b.label));
      if (!rule) continue;
      const want = rule[1];
      const ok = b.kind === "wrap" ? b.iconProp === want : new RegExp(`["']${want}["']`).test(b.src);
      if (!ok) wrong.push(`${b.file}:${b.line} «${b.label}» should wear "${want}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("names only icons that exist", () => {
    for (const [, name] of ACTION_ICONS) expect(ICONS, name).toHaveProperty(name);
  });

  it("matches a verb with a busy prefix and a typed plus stripped", () => {
    const rule = (l: string) => ACTION_ICONS.find(([re]) => re.test(l))?.[1];
    expect(rule("ذخیرهٔ یادآوری")).toBe("save");
    expect(rule("ذخیره کردم")).toBe("check");
    expect(rule("حذف از مسیر")).toBe("minus");
    expect(rule("حذف عکس")).toBe("trash");
    expect(rule("افزودن به برنامه")).toBe("calendar-plus");
  });
});
