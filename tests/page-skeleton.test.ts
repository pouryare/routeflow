import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PageSkeleton, { PAGE_SHAPES } from "@/components/meridian/PageSkeleton";
import { SkeletonRows } from "@/components/Skeleton";
import { CAPTURES } from "@/lib/skeletons";

const blocks = (html: string) => (html.match(/class="skeleton[ "]/g) ?? []).length;

/** Item 20: "there were supposed to be shimmering Skeleton not multiple tiny cards!!!!"
 *
 *  Two defects in one sentence. The shapes drew a scatter of small tiles (the board was
 *  twelve), and in the light theme the shimmer could not be seen at all: the block was
 *  --surface-raised (#FFFFFF) and the sweep a 6%-white gradient, white on white. Both are
 *  pinned here. */
describe("page skeletons are silhouettes, not tile scatters", () => {
  it.each(PAGE_SHAPES)("%s draws at most four masses", (shape) => {
    const html = renderToStaticMarkup(createElement(PageSkeleton, { shape }));
    expect(blocks(html)).toBeGreaterThan(0);
    expect(blocks(html)).toBeLessThanOrEqual(4);
  });

  it("an in-page list placeholder is one card of lines, not a card per row", () => {
    const html = renderToStaticMarkup(createElement(SkeletonRows, { rows: 6 }));
    expect((html.match(/border-border/g) ?? []).length).toBe(1);
  });
});

/** Captured skeletons (npm run skeletons:capture): each loading.tsx names its own route, and a
 *  capture keeps item 20's spirit by drawing cards as plain surfaces with only the lines
 *  inside them shimmering. */
describe("captured page skeletons", () => {
  const shell = path.join(import.meta.dirname, "../app/(shell)");
  const loadings: { route: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "loading.tsx") {
        const segs = path.relative(shell, dir).split(path.sep).filter((s) => s && !s.startsWith("("));
        loadings.push({ route: "/" + segs.join("/"), source: readFileSync(p, "utf8") });
      }
    }
  };
  walk(shell);

  it.each(loadings.map((l) => [l.route, l.source]))("%s passes its own route", (route, source) => {
    expect(source).toContain(`route="${route}"`);
  });

  it("every capture belongs to a route that still has a loading screen", () => {
    const routes = new Set(loadings.map((l) => l.route));
    expect(Object.keys(CAPTURES).filter((r) => !routes.has(r))).toEqual([]);
  });

  it("draws cards as plain surfaces and shimmers only the lines", () => {
    const route = Object.keys(CAPTURES).find((r) => CAPTURES[r].phone.bones.some((b) => b[5]))!;
    const { bones } = CAPTURES[route].phone;
    const html = renderToStaticMarkup(createElement(PageSkeleton, { route }));
    const phone = html.split('class="relative overflow-hidden')[1];
    expect(blocks(phone)).toBe(bones.filter((b) => !b[5]).length);
    expect((phone.match(/border-border bg-surface/g) ?? []).length).toBe(bones.filter((b) => b[5]).length);
  });

  it("a route with no capture falls back to its shape", () => {
    const html = renderToStaticMarkup(createElement(PageSkeleton, { route: "/no-such-page", shape: "chart" }));
    expect(html).toBe(renderToStaticMarkup(createElement(PageSkeleton, { shape: "chart" })));
  });
});

describe("the shimmer is visible in the meridian theme", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  it("the block sits on a sunk tone, not on the card colour it would vanish into", () => {
    expect(css).toMatch(/\.meridian \.skeleton \{[^}]*background: var\(--surface-tertiary\)/);
  });
  it("the sweep is a highlight mixed from a token, not a fixed near-transparent white", () => {
    expect(css).toMatch(/\.meridian \.skeleton::after \{[^}]*color-mix\(in srgb, var\(--surface\)/);
  });
});
