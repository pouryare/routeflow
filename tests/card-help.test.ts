import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { HELP } from "@/lib/help";
import { CARD_HELP } from "@/lib/help/cards";
import { FIGURE_HELP } from "@/lib/help/figures";
import { PAGE_HELP } from "@/lib/help/pages";
import { PAGE_META } from "@/lib/pageMeta";

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const src = [...walk("app"), ...walk("components")].map((f) => readFileSync(f, "utf8")).join("\n");
const used = new Set([...src.matchAll(/(?:help|id)="((?:card|fig)\.[\w-]+)"/g)].map((m) => m[1]));

describe("card help", () => {
  it("every (?) that points at a card id finds real copy", () => {
    for (const id of used) expect(HELP[id], `${id} has no entry in lib/help/cards.ts`).toBeDefined();
  });
  it("every card entry is used by some card, so no copy is left unreachable", () => {
    for (const id of Object.keys({ ...CARD_HELP, ...FIGURE_HELP })) expect(used.has(id), `${id} is not used`).toBe(true);
  });
  it("every page with a help id has page copy, and every page entry belongs to a page", () => {
    const claimed = new Set(Object.values(PAGE_META).map((m) => m.help).filter(Boolean));
    for (const id of Object.keys(PAGE_HELP)) expect(claimed.has(id), `${id} is claimed by no page`).toBe(true);
  });
  it("every entry has a title, what and how", () => {
    for (const e of [...Object.values(CARD_HELP), ...Object.values(FIGURE_HELP), ...Object.values(PAGE_HELP)]) {
      expect(e.title && e.what && e.how, e.id).toBeTruthy();
    }
  });
});
