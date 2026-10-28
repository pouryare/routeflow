

/** Map geometry colours.
 *
 *  These cannot be `var(--map-stroke-major)`: MapLibre paints them on the GPU from its
 *  own style properties, where var() is just an unrecognised string. So the value has
 *  to be a real colour by the time the map sees it.
 *
 *  It is still defined in CSS -- app/globals.css, per accent theme, per skin -- and read
 *  back out here with getComputedStyle. Ten themes times two skins times two grounds is
 *  forty palettes; duplicating those in TypeScript would guarantee the stylesheet and the
 *  map disagreed within a release. One definition, resolved at the point of use.
 *
 *  The fallbacks are the shipping terracotta, and they matter: getComputedStyle returns
 *  "" for a property that has not been applied yet, which on the very first paint would
 *  otherwise hand the map an empty string. */
export const MAP_INK_FALLBACK = {
  light: { strokeMajor: "#6B5B4C", strokeMinor: "#8A7A69", selected: "#C0532B", boundary: "#998876", unknown: "#7D7166", accent: "#0b7c82", accentInk: "#ffffff", bg: "#f1f4f7" },
  dark:  { strokeMajor: "#9A8A78", strokeMinor: "#8A7A69", selected: "#E8734A", boundary: "#6E6055", unknown: "#7D7166", accent: "#2de0e6", accentInk: "#04191c", bg: "#0a0e14" },
} as const;

export interface MapInk {
  strokeMajor: string;
  strokeMinor: string;
  selected: string;
  boundary: string;
  /** The fill for a district whose coverage is unknown -- 429 of 439 of them, so this is
   *  the colour the map mostly IS, and the reason the theme has to reach it. */
  unknown: string;
  /** Cluster bubbles, which mix every status underneath and so take the accent. */
  accent: string;
  accentInk: string;
  /** The rim round each customer marker, so touching markers stay separate. */
  bg: string;
}

/** Resolves the map ink for a ground out of the live stylesheet.
 *
 *  `ground` and not the page skin: the strokes sit on the basemap, so a cream basemap
 *  needs dark strokes whatever the surrounding UI is doing. The dark set is read by
 *  temporarily asking for the dark-skin values -- see useMapInk, which does this by
 *  reading from an element that carries the right attributes rather than by guessing. */
export function readMapInk(el: HTMLElement | null, ground: "light" | "dark"): MapInk {
  const fb = MAP_INK_FALLBACK[ground];
  if (!el || typeof window === "undefined") return { ...fb };
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    strokeMajor: get("--map-stroke-major", fb.strokeMajor),
    strokeMinor: get("--map-stroke-minor", fb.strokeMinor),
    selected: get("--map-selected", fb.selected),
    boundary: get("--map-boundary", fb.boundary),
    unknown: get("--map-unknown", fb.unknown),
    accent: get("--accent", fb.accent),
    accentInk: get("--accent-ink", fb.accentInk),
    bg: get("--bg", fb.bg),
  };
}
