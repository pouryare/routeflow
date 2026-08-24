import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  DEFAULT_LAYERS,
  OVERLAYS,
  OVERLAY_GROUPS,
  basemapDef,
  changedFromDefault,
  isBasemapId,
  parseLayerPrefs,
} from "@/lib/mapLayers";

describe("parseLayerPrefs", () => {
  it("falls back to the defaults for nothing stored", () => {
    expect(parseLayerPrefs(null)).toEqual(DEFAULT_LAYERS);
  });

  it("keeps what was stored", () => {
    const prefs = parseLayerPrefs(JSON.stringify({ heatmap: true, customers: false }));
    expect(prefs.heatmap).toBe(true);
    expect(prefs.customers).toBe(false);
  });

  it("fills a key an older version never wrote with its default, not with false", () => {
    // A blob saved before a layer existed is missing that key. Reading missing as "off"
    // would silently switch off the customers the moment a new layer shipped.
    const prefs = parseLayerPrefs(JSON.stringify({ heatmap: true }));
    expect(prefs.customers).toBe(DEFAULT_LAYERS.customers);
    expect(prefs.districts).toBe(DEFAULT_LAYERS.districts);
  });

  it("ignores values of the wrong type and unknown keys", () => {
    const prefs = parseLayerPrefs(JSON.stringify({ heatmap: "yes", nonsense: true }));
    expect(prefs.heatmap).toBe(DEFAULT_LAYERS.heatmap);
    expect(prefs).toEqual(DEFAULT_LAYERS);
  });

  it("survives a corrupted blob", () => {
    expect(parseLayerPrefs("{not json")).toEqual(DEFAULT_LAYERS);
    expect(parseLayerPrefs("[]")).toEqual(DEFAULT_LAYERS);
    expect(parseLayerPrefs("null")).toEqual(DEFAULT_LAYERS);
  });
});

describe("changedFromDefault", () => {
  it("is zero for a fresh install", () => {
    expect(changedFromDefault(DEFAULT_LAYERS)).toBe(0);
  });

  it("counts turning something on and turning something off alike", () => {
    // Both are "you changed the map from how it usually looks", which is what the badge
    // on the button is telling you.
    expect(changedFromDefault({ ...DEFAULT_LAYERS, heatmap: true })).toBe(1);
    expect(changedFromDefault({ ...DEFAULT_LAYERS, customers: false })).toBe(1);
    expect(changedFromDefault({ ...DEFAULT_LAYERS, heatmap: true, customers: false })).toBe(2);
  });
});

describe("the catalogue", () => {
  it("gives every overlay a group that the panel renders", () => {
    const groups = new Set(OVERLAY_GROUPS.map((g) => g.id));
    for (const o of OVERLAYS) expect(groups.has(o.group)).toBe(true);
  });

  it("has a default for every overlay, and no defaults for overlays that do not exist", () => {
    expect(Object.keys(DEFAULT_LAYERS).sort()).toEqual(OVERLAYS.map((o) => o.id).sort());
  });

  it("gives every overlay and basemap a distinct id", () => {
    expect(new Set(OVERLAYS.map((o) => o.id)).size).toBe(OVERLAYS.length);
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length);
  });

  it("marks exactly the basemap that carries its own names", () => {
    // The panel uses this to stop offering a names overlay that would be drawn twice.
    expect(BASEMAPS.filter((b) => b.hasLabels).map((b) => b.id)).toEqual(["streets"]);
  });

  it("puts {z}/{x}/{y} in every tile URL, and {s} only where subdomains are set", () => {
    for (const b of BASEMAPS) {
      expect(b.url).toContain("{z}");
      expect(b.url).toContain("{x}");
      expect(b.url).toContain("{y}");
      // Leaflet leaves a literal "{s}" in the URL when no subdomains are configured,
      // which 404s every tile.
      expect(b.url.includes("{s}")).toBe(!!b.subdomains);
    }
  });

  it("falls back to the first basemap for an unknown id", () => {
    expect(basemapDef("nope" as never)).toBe(BASEMAPS[0]);
    expect(isBasemapId("dark")).toBe(true);
    expect(isBasemapId("nope")).toBe(false);
  });
});
