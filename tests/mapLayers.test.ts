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

  it("never claims imagery carries its own names", () => {
    // The panel offers the names overlay whenever hasLabels is false. Photography never
    // has names; a "base" style may or may not (the -plain vector styles do not), so this
    // asserts the one direction that is actually a rule.
    for (const b of buildBasemaps(ALL_KEYS)) {
      if (b.kind === "imagery") expect(b.hasLabels).toBe(false);
    }
    expect(buildBasemaps(ALL_KEYS).some((b) => b.kind === "imagery")).toBe(true);
  });

  it("gives every basemap a ground, so the overlays always know what they sit on", () => {
    for (const b of buildBasemaps(ALL_KEYS)) {
      expect(["light", "dark"]).toContain(b.ground);
    }
  });

  it("puts {z}/{x}/{y} in every raster tile URL, and {s} only where subdomains are set", () => {
    for (const b of buildBasemaps(ALL_KEYS)) {
      // A vector style has no raster template of its own; its fallback carries one.
      const urls = b.styleUrl ? [b.rasterFallback!.url] : [b.url];
      const subs = b.styleUrl ? b.rasterFallback!.subdomains : b.subdomains;
      for (const url of urls) {
        expect(url).toContain("{z}");
        expect(url).toContain("{x}");
        expect(url).toContain("{y}");
        // Leaflet leaves a literal "{s}" in the URL when no subdomains are configured,
        // which 404s every tile.
        expect(url.includes("{s}")).toBe(!!subs);
      }
    }
  });

  it("gives every vector style a raster fallback and no raster url of its own", () => {
    // Without a fallback a device with no WebGL gets an empty grey ground and no way to
    // tell that from a broken app.
    const vector = buildBasemaps(ALL_KEYS).filter((b) => b.styleUrl);
    expect(vector.length).toBeGreaterThan(0);
    for (const b of vector) {
      expect(b.url).toBe("");
      expect(b.rasterFallback).toBeTruthy();
      expect(b.styleUrl).toMatch(/^https:\/\/basemaps\.cartocdn\.com\/gl\//);
    }
  });

  it("keeps the CARTO vector styles keyless, so they work with no account at all", () => {
    // Their raster CDN watermarks unkeyed tiles and ignores the account token; the GL
    // styles do not. If a key ever appeared in one of these URLs it would mean the
    // catalogue had quietly gone back to a gated endpoint.
    for (const b of buildBasemaps()) {
      if (b.styleUrl) expect(b.styleUrl).not.toMatch(/key|token/i);
    }
  });

  it("falls back to the first basemap for an unknown id", () => {
    expect(basemapDef("nope" as never)).toBe(BASEMAPS[0]);
    expect(isBasemapId("dark")).toBe(true);
    expect(isBasemapId("nope")).toBe(false);
  });
});

describe("buildBasemaps", () => {
  const NO_KEY_IDS = [
    "dark", "radar", "apple", "positron", "voyager",
    "radar-plain", "positron-plain", "voyager-plain",
    "streets", "satellite", "topo", "hot",
  ];

  it("with no keys, offers only the styles that need none", () => {
    expect(buildBasemaps().map((b) => b.id)).toEqual(NO_KEY_IDS);
    expect(buildBasemaps({}).map((b) => b.id)).toEqual(NO_KEY_IDS);
  });

  it("keeps radar on CARTO Dark Matter whatever the keys are", () => {
    // This is the whole point of the vector path: the pre-redesign basemap is free and
    // unkeyed, so «رادار» must never silently degrade to a stand-in when a key is absent
    // -- or present.
    for (const keys of [{}, { stadia: "K" }, { maptiler: "K" }, ALL_KEYS]) {
      const radar = buildBasemaps(keys).find((b) => b.id === "radar")!;
      expect(radar.styleUrl).toBe(
        "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      );
      expect(radar.ground).toBe("dark");
    }
  });

  it("upgrades the vector raster-fallback as keys appear", () => {
    const fb = (keys: Parameters<typeof buildBasemaps>[0]) =>
      buildBasemaps(keys).find((b) => b.id === "radar")!.rasterFallback!;
    expect(fb({}).toneClass).toBe("tiles-radar");
    expect(fb({ maptiler: "K" }).url).toContain("api.maptiler.com");
    expect(fb({ stadia: "K" }).url).toContain("alidade_smooth_dark");
    // Stadia wins when both are set.
    expect(fb(ALL_KEYS).url).toContain("stadiamaps.com");
  });

  it("with no keys, the quiet and apple basemaps are a CSS tone on OpenStreetMap", () => {
    const byId = Object.fromEntries(buildBasemaps().map((b) => [b.id, b]));
    expect(byId.apple.toneClass).toBe("tiles-apple");
    expect(byId.dark.toneClass).toBe("tiles-quiet");
    for (const id of ["apple", "dark"]) {
      expect(byId[id].url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    }
  });

  it("upgrades apple to Stadia when the Stadia key is set", () => {
    const byId = Object.fromEntries(buildBasemaps({ stadia: "K" }).map((b) => [b.id, b]));
    expect(byId.apple.url).toContain("alidade_smooth");
    expect(byId.apple.toneClass).toBeUndefined();
    expect(buildBasemaps({ stadia: "K" }).map((b) => b.id)).toEqual(
      expect.arrayContaining(["toner", "terrain", "watercolor"]),
    );
  });

  it("upgrades apple to MapTiler when only the MapTiler key is set", () => {
    const byId = Object.fromEntries(buildBasemaps({ maptiler: "K" }).map((b) => [b.id, b]));
    expect(byId.apple.url).toContain("api.maptiler.com");
    expect(buildBasemaps({ maptiler: "K" }).map((b) => b.id)).toEqual(
      expect.arrayContaining(["mt-basic", "mt-streets", "mt-outdoor", "mt-satellite"]),
    );
  });

  it("prefers Stadia over MapTiler for apple when both keys are set", () => {
    const byId = Object.fromEntries(buildBasemaps(ALL_KEYS).map((b) => [b.id, b]));
    expect(byId.apple.url).toContain("stadiamaps.com");
    expect(buildBasemaps(ALL_KEYS)).toHaveLength(19);
  });

  it("never leaks a key into a label or hint", () => {
    for (const b of buildBasemaps({ maptiler: "SECRET_MT", stadia: "SECRET_ST" })) {
      expect(b.label).not.toMatch(/SECRET_/);
      expect(b.hint).not.toMatch(/SECRET_/);
    }
  });
});
