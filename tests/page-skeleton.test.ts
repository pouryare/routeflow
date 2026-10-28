import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PageSkeleton, { PAGE_SHAPES } from "@/components/meridian/PageSkeleton";
import { SkeletonRows } from "@/components/Skeleton";

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

describe("the shimmer is visible in the meridian theme", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  it("the block sits on a sunk tone, not on the card colour it would vanish into", () => {
    expect(css).toMatch(/\.meridian \.skeleton \{[^}]*background: var\(--surface-tertiary\)/);
  });
  it("the sweep is a highlight mixed from a token, not a fixed near-transparent white", () => {
    expect(css).toMatch(/\.meridian \.skeleton::after \{[^}]*color-mix\(in srgb, var\(--surface\)/);
  });
});
