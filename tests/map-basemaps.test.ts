import { describe, it, expect } from "vitest";
import { DEFAULT_BASEMAPS, basemapDef, parseBasemaps } from "@/lib/mapLayers";

/** The map follows the skin: one basemap per skin, a light one under the light skin.
 *
 *  It used to keep a single basemap and pin its canvas dark whatever skin was chosen, so
 *  a light page opened onto a black map. These are the rules that replaced that. */
describe("per-skin basemaps", () => {
  it("defaults to a dark basemap under the dark skin and a light one under the light skin", () => {
    expect(basemapDef(DEFAULT_BASEMAPS.dark).ground).toBe("dark");
    expect(basemapDef(DEFAULT_BASEMAPS.light).ground).toBe("light");
    expect(parseBasemaps(null, null)).toEqual(DEFAULT_BASEMAPS);
  });

  it("reads each skin's saved choice, and ignores ids that are not basemaps", () => {
    expect(parseBasemaps(JSON.stringify({ dark: "black", light: "grayscale" }), null)).toEqual({
      dark: "black",
      light: "grayscale",
    });
    expect(parseBasemaps(JSON.stringify({ dark: "nope", light: 7 }), null)).toEqual(DEFAULT_BASEMAPS);
  });

  it("keeps an old single-basemap choice for the skin whose ground it matches", () => {
    expect(parseBasemaps(null, "white")).toEqual({ ...DEFAULT_BASEMAPS, light: "white" });
    expect(parseBasemaps(null, "black")).toEqual({ ...DEFAULT_BASEMAPS, dark: "black" });
    expect(parseBasemaps("{not json", "white")).toEqual({ ...DEFAULT_BASEMAPS, light: "white" });
  });

  it("prefers the per-skin key over the old one", () => {
    expect(parseBasemaps(JSON.stringify({ dark: "black", light: "light" }), "white").light).toBe("light");
  });
});
