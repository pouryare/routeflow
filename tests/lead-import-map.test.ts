import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** The map layer, tested on the parts that are pure.
 *
 *  Per this repo's convention (see tests/LocationCard.test.ts) the component is not
 *  mounted; what matters is which items become pins, and that the map is loaded in a way
 *  that cannot break a prerender. */

/** Mirrors usePins in components/leadImport/ImportMap.tsx. */
function pinsFor(
  items: { id: number; lat: number | null; lng: number | null; name: string }[]
): { id: number; lat: number; lng: number }[] {
  return items
    .filter((i) => i.lat !== null && i.lng !== null)
    .map((i) => ({ id: i.id, lat: i.lat as number, lng: i.lng as number }));
}

const item = (id: number, lat: number | null, lng: number | null) => ({ id, lat, lng, name: `م${id}` });

describe("which items become pins", () => {
  it("plots a decoded link", () => {
    expect(pinsFor([item(1, 35.7, 51.4)])).toHaveLength(1);
  });

  // A link with no coordinates has no place to sit. Plotting it at 0,0 would put a pin
  // in the Gulf of Guinea and quietly corrupt the picture the user is reading.
  it("plots nothing for a link that never got coordinates", () => {
    expect(pinsFor([item(1, null, null)])).toEqual([]);
  });

  it("plots only the coordinates that exist, in a mixed batch", () => {
    const pins = pinsFor([item(1, 35.7, 51.4), item(2, null, null), item(3, 35.8, 51.5)]);
    expect(pins.map((p) => p.id)).toEqual([1, 3]);
  });

  it("keeps every pin, so the map shows the whole batch and not a sample", () => {
    // 1000 markers is the case the clustering dependency exists for; truncating here
    // would make the map quietly lie about how much is left.
    const many = Array.from({ length: 1000 }, (_, i) => item(i, 35.5 + i * 0.001, 51.3));
    expect(pinsFor(many)).toHaveLength(1000);
  });

  it("is empty for a batch that has decoded nothing yet", () => {
    expect(pinsFor([])).toEqual([]);
  });
});

describe("the map is loaded so it cannot break a prerender", () => {
  const console = readFileSync(
    path.resolve(process.cwd(), "components/leadImport/DecodeConsole.tsx"),
    "utf8"
  );

  it("is imported through next/dynamic with ssr disabled", () => {
    // MapLibre reads `window` when it is evaluated, so a static import here would fail
    // the build exactly as /analytics did before it was fixed.
    expect(console).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("\.\/ImportMap"\)/);
    expect(console).toMatch(/ssr:\s*false/);
  });

  it("does not import the map module directly", () => {
    expect(console).not.toMatch(/^import .* from "\.\/ImportMap";$/m);
  });
});

describe("the pin drop respects reduced motion", () => {
  const css = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");

  it("has a reduced-motion rule that stops the pin animation", () => {
    expect(css).toMatch(/\.leadimport-pin-drop\s*\{\s*animation:\s*none;\s*\}/);
  });
});
