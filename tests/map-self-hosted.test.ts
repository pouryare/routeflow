import { describe, expect, it } from "vitest";
import { parseTileCoord } from "@/lib/mapTiles";
import { BASEMAP_LABELS, protomapsStyle } from "@/lib/mapStyle";
import { BASEMAPS } from "@/lib/mapLayers";
import { markerImage } from "@/components/coverage/markerImages";

describe("tile coordinates from the URL", () => {
  it("accepts a real tile and refuses anything the file could not hold", () => {
    expect(parseTileCoord("12", "2632", "1612")).toEqual({ z: 12, x: 2632, y: 1612 });
    expect(parseTileCoord("16", "0", "0")).toBeNull(); // past the file's deepest zoom
    expect(parseTileCoord("2", "4", "0")).toBeNull(); // off the grid at that zoom
    expect(parseTileCoord("3", "-1", "0")).toBeNull();
    expect(parseTileCoord("3", "1.5", "0")).toBeNull();
    expect(parseTileCoord("3", "1", "2.pbf")).toBeNull();
  });
});

describe("the map style", () => {
  const origin = "https://app.example";

  it("asks nothing of any host but our own", () => {
    for (const b of BASEMAPS) {
      const urls = JSON.stringify(protomapsStyle(b.flavor, origin, { labels: b.hasLabels })).match(/https?:\/\/[^"\\ ]+/g) ?? [];
      // Attribution links are text in the credit line, not requests.
      const fetched = urls.filter((u) => !/protomaps\.com|openstreetmap\.org\/copyright/.test(u));
      expect(fetched.every((u) => u.startsWith(origin))).toBe(true);
    }
  });

  it("draws labels in the app's own Persian font, in Persian", () => {
    const style = protomapsStyle("light", origin);
    const faces = JSON.stringify(style["font-faces"]);
    expect(faces).toContain("/fonts/PeydaFaNumWeb-Regular.woff2");
    expect(JSON.stringify(style.layers)).toContain("name:fa");
    // Protomaps' Noto stacks would need a glyph server; only its Devanagari case remains.
    expect(JSON.stringify(style.layers)).not.toMatch(/Noto Sans (Regular|Medium|Italic)/);
  });

  it("keeps the label layer that app data is drawn under, even when names are off", () => {
    const plain = protomapsStyle("black", origin, { labels: false });
    const anchor = plain.layers.find((l) => l.id === BASEMAP_LABELS);
    expect(anchor).toBeDefined();
    expect(plain.layers.filter((l) => l.type === "symbol").every((l) => l.layout?.visibility === "none")).toBe(true);
  });
});

describe("customer marker images", () => {
  // MapLibre reads 0.75 of full alpha as the shape's edge: above is fill, below is rim.
  it("are inside the shape in the middle and outside it in the corners, for every shape", () => {
    for (const shape of ["diamond", "circle", "square", "triangle"] as const) {
      const { width, data } = markerImage(shape);
      const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
      expect(alpha(width / 2, width / 2)).toBe(255);
      expect(alpha(0, 0)).toBeLessThan(191);
    }
  });
});
