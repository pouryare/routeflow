import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  DEFAULT_LAYERS,
  OVERLAYS,
  OVERLAY_GROUPS,
  basemapDef,
  buildBasemaps,
  changedFromDefault,
  isBasemapId,
  parseLayerPrefs,
} from "@/lib/mapLayers";

const ALL_KEYS = { maptiler: "MT_TEST", stadia: "ST_TEST" };

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
    for (const keys of [{}, { maptiler: "M" }, { stadia: "S" }, ALL_KEYS]) {
      const ids = buildBasemaps(keys).map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("ties the names overlay to kind, not to a hard-coded list of basemaps", () => {
    // The panel offers the names overlay only over imagery, because every "base" style
    // draws its own names. Checked as a rule so a new basemap is a decision about its
    // kind, not an automatically failing test.
    for (const b of buildBasemaps(ALL_KEYS)) {
      if (b.kind === "imagery") expect(b.hasLabels).toBe(false);
      else expect(b.hasLabels).toBe(true);
    }
    expect(buildBasemaps(ALL_KEYS).some((b) => b.kind === "imagery")).toBe(true);
  });

  it("puts {z}/{x}/{y} in every tile URL, and {s} only where subdomains are set", () => {
    for (const b of buildBasemaps(ALL_KEYS)) {
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

describe("buildBasemaps", () => {
  const NO_KEY_IDS = ["dark", "radar", "apple", "streets", "satellite", "topo", "hot"];

  it("with no keys, offers only the styles that need none", () => {
    expect(buildBasemaps().map((b) => b.id)).toEqual(NO_KEY_IDS);
    expect(buildBasemaps({}).map((b) => b.id)).toEqual(NO_KEY_IDS);
  });

  it("with no keys, radar and apple are a CSS tone on OpenStreetMap", () => {
    const byId = Object.fromEntries(buildBasemaps().map((b) => [b.id, b]));
    expect(byId.radar.toneClass).toBe("tiles-radar");
    expect(byId.apple.toneClass).toBe("tiles-apple");
    expect(byId.dark.toneClass).toBe("tiles-quiet");
    for (const id of ["radar", "apple", "dark"]) {
      expect(byId[id].url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    }
  });

  it("upgrades radar and apple to Stadia when the Stadia key is set", () => {
    const byId = Object.fromEntries(buildBasemaps({ stadia: "K" }).map((b) => [b.id, b]));
    expect(byId.radar.url).toContain("stadiamaps.com");
    expect(byId.radar.url).toContain("alidade_smooth_dark");
    expect(byId.radar.toneClass).toBeUndefined();
    expect(byId.apple.url).toContain("alidade_smooth");
    expect(byId.apple.toneClass).toBeUndefined();
    // and adds the Stamen styles
    expect(buildBasemaps({ stadia: "K" }).map((b) => b.id)).toEqual(
      expect.arrayContaining(["toner", "terrain", "watercolor"]),
    );
  });

  it("upgrades radar and apple to MapTiler when only the MapTiler key is set", () => {
    const byId = Object.fromEntries(buildBasemaps({ maptiler: "K" }).map((b) => [b.id, b]));
    expect(byId.radar.url).toContain("api.maptiler.com");
    expect(byId.apple.url).toContain("api.maptiler.com");
    expect(buildBasemaps({ maptiler: "K" }).map((b) => b.id)).toEqual(
      expect.arrayContaining(["mt-basic", "mt-streets", "mt-outdoor", "mt-satellite"]),
    );
  });

  it("prefers Stadia over MapTiler for radar and apple when both keys are set", () => {
    const byId = Object.fromEntries(buildBasemaps(ALL_KEYS).map((b) => [b.id, b]));
    expect(byId.radar.url).toContain("stadiamaps.com");
    expect(byId.apple.url).toContain("stadiamaps.com");
    expect(buildBasemaps(ALL_KEYS)).toHaveLength(14);
  });

  it("never leaks a key into a label or hint", () => {
    for (const b of buildBasemaps({ maptiler: "SECRET_MT", stadia: "SECRET_ST" })) {
      expect(b.label).not.toMatch(/SECRET_/);
      expect(b.hint).not.toMatch(/SECRET_/);
    }
  });
});
