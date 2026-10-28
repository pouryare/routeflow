import type { IconName } from "@/components/meridian/icon-map";
import type { MapFlavor } from "@/lib/mapStyle";
/** What can be drawn on the map, in one list.
 *
 *  These toggles used to be scattered: satellite behind a floating 🛰 button, the heatmap
 *  and the warehouse corridor in two different sidebar sections, and the districts,
 *  customers and depots not switchable at all. "What is on my map" had no single answer
 *  and no single place to change it.
 *
 *  The catalogue lives here rather than inside the map component so the labels, the
 *  ordering and the storage shape can be read and tested without a browser.
 */

export type BasemapId =
  | "light"
  | "dark"
  | "white"
  | "grayscale"
  | "black"
  | "white-plain"
  | "black-plain";

/** What the basemap's ground looks like, which decides how the app's own overlays are
 *  inked on top of it -- see MAP_INK in components/CoverageMap.tsx and the
 *  `[data-ground]` blocks in globals.css. Independent of the page theme: choosing a cream
 *  basemap on a dark skin has to lighten the district strokes, or they vanish. */
export type BasemapGround = "dark" | "light";

/** Every basemap is a Protomaps style over the tiles this server holds (lib/mapStyle.ts,
 *  lib/mapTiles.ts). No map request goes to a foreign host (owner's decision,
 *  2026-10-28), which is why satellite, topo and the keyed providers are gone. */
export interface BasemapDef {
  id: BasemapId;
  label: string;
  icon: IconName;
  hint: string;
  flavor: MapFlavor;
  /** Whether street and place names are drawn. */
  hasLabels: boolean;
  ground: BasemapGround;
}

export const BASEMAPS: BasemapDef[] = [
  {
    id: "light", label: "روشن", icon: "sun", flavor: "light", ground: "light", hasLabels: true,
    hint: "روشن و نرم، با نام خیابان‌ها به فارسی. نمای همه‌منظورهٔ روز.",
  },
  {
    id: "dark", label: "تیره", icon: "moon", flavor: "dark", ground: "dark", hasLabels: true,
    hint: "تیره و آرام، تا رنگ‌های مشتری‌ها و مناطق دیده شوند. برای شب.",
  },
  {
    id: "white", label: "سپید", icon: "dot", flavor: "white", ground: "light", hasLabels: true,
    hint: "بسیار روشن و کم‌جزئیات — کم‌سروصداترین زمینه برای وقتی داده‌ها شلوغ‌اند.",
  },
  {
    id: "grayscale", label: "خاکستری", icon: "contrast", flavor: "grayscale", ground: "light", hasLabels: true,
    hint: "بدون رنگ — وقتی رنگِ داده‌ها باید تنها رنگِ صفحه باشد.",
  },
  {
    id: "black", label: "رادار", icon: "radar", flavor: "black", ground: "dark", hasLabels: true,
    hint: "زمینهٔ نزدیک به سیاه با خیابان‌های نازک. برای دیده‌شدن رنگ وضعیت‌ها.",
  },
  {
    id: "white-plain", label: "سپید (بی‌نام)", icon: "dot", flavor: "white", ground: "light", hasLabels: false,
    hint: "سپید بدون نام. خلوت‌ترین زمینهٔ ممکن زیر مرزها و پین‌ها.",
  },
  {
    id: "black-plain", label: "رادار (بی‌نام)", icon: "radar", flavor: "black", ground: "dark", hasLabels: false,
    hint: "رادار بدون هیچ نامی — وقتی برچسب‌های نقشه با نام مشتری‌ها تداخل دارند.",
  },
];

export function basemapDef(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function isBasemapId(v: unknown): v is BasemapId {
  return typeof v === "string" && BASEMAPS.some((b) => b.id === v);
}

export type OverlayId =
  | "traffic_zone"
  | "low_emission"
  | "districts"
  | "customers"
  | "facilities"
  | "heatmap"
  | "corridor";

export type OverlayGroup = "restrictions" | "data";

export interface OverlayDef {
  id: OverlayId;
  label: string;
  icon: IconName;
  hint: string;
  group: OverlayGroup;
}

export const OVERLAY_GROUPS: { id: OverlayGroup; label: string }[] = [
  { id: "restrictions", label: "محدودیت‌های ترافیکی" },
  { id: "data", label: "داده‌های شما" },
];

export const OVERLAYS: OverlayDef[] = [
  {
    id: "traffic_zone",
    label: "محدوده طرح ترافیک",
    icon: "ban",
    hint: "محدوده مرکزی. در ساعت طرح بدون مجوز نمی‌شود وارد شد.",
    group: "restrictions",
  },
  {
    id: "low_emission",
    label: "محدوده کنترل آلودگی هوا",
    icon: "fog",
    hint: "محدوده بزرگ‌تر بیرونی (همت، بعثت، امام علی، نواب/چمران). ورود در ساعت طرح، یک روز از سهمیه فصلی کم می‌کند.",
    group: "restrictions",
  },
  {
    id: "customers",
    label: "مشتریان",
    icon: "map-pin",
    hint: "پین همه مشتری‌های فیلترشده.",
    group: "data",
  },
  {
    id: "districts",
    label: "مناطق و محله‌ها",
    icon: "map",
    hint: "مرز و رنگ وضعیت پوشش.",
    group: "data",
  },
  {
    id: "facilities",
    label: "انبار و مبدأ",
    icon: "building",
    hint: "جایگاه‌های خودمان.",
    group: "data",
  },
  {
    id: "heatmap",
    label: "نقشه حرارتی",
    icon: "flame",
    hint: "تراکم مشتری‌ها.",
    group: "data",
  },
  {
    id: "corridor",
    label: "کریدور بین انبارها",
    icon: "route",
    hint: "نواری به عرض دلخواه دور مسیر واقعی بین دو انبار.",
    group: "data",
  },
];

export type LayerPrefs = Record<OverlayId, boolean>;

/** What is on when nothing has been chosen. The three that draw this app's own data are
 *  on, because a map with no customers on it is not this app; everything else is off, so
 *  the first view is the quiet one it has always been. */
export const DEFAULT_LAYERS: LayerPrefs = {
  traffic_zone: false,
  low_emission: false,
  customers: true,
  districts: true,
  facilities: true,
  heatmap: false,
  corridor: false,
};

export const LAYERS_KEY = "coverage_layers";
export const BASEMAP_KEY = "coverage_basemap";

/** The basemap chosen for each skin.
 *
 *  The map used to keep one basemap and pin its whole canvas dark whatever skin the
 *  reader chose, so a light page opened onto a black map with its panels re-coloured by
 *  half. Now the map follows the skin like every other surface: each skin remembers its
 *  own basemap, dark starts on «تیره» and light on «روشن», and flipping the skin swaps
 *  between the two. Picking a basemap from the layers panel changes only the current
 *  skin's choice. */
export type BasemapBySkin = { dark: BasemapId; light: BasemapId };
export const DEFAULT_BASEMAPS: BasemapBySkin = { dark: "dark", light: "light" };
export const BASEMAPS_KEY = "coverage_basemaps";

/** Reads the per-skin choice. A browser that only has the old single-basemap key keeps
 *  that choice for the skin whose ground it matches. */
export function parseBasemaps(raw: string | null, legacy: string | null): BasemapBySkin {
  const out: BasemapBySkin = { ...DEFAULT_BASEMAPS };
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<Record<keyof BasemapBySkin, unknown>> | null;
      if (v && typeof v === "object") {
        if (isBasemapId(v.dark)) out.dark = v.dark;
        if (isBasemapId(v.light)) out.light = v.light;
        return out;
      }
    } catch {
      // Unreadable: fall back to the old key below.
    }
  }
  if (isBasemapId(legacy)) out[basemapDef(legacy).ground] = legacy;
  return out;
}

/** Merged over the defaults rather than trusted wholesale: a stored blob written by an
 *  older version is missing whatever has been added since, and a missing key must read as
 *  its default rather than as "off". */
export function parseLayerPrefs(raw: string | null): LayerPrefs {
  if (!raw) return { ...DEFAULT_LAYERS };
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LAYERS };
  }
  if (typeof stored !== "object" || stored === null) return { ...DEFAULT_LAYERS };

  const out = { ...DEFAULT_LAYERS };
  for (const o of OVERLAYS) {
    const v = (stored as Record<string, unknown>)[o.id];
    if (typeof v === "boolean") out[o.id] = v;
  }
  return out;
}

/** How many overlays are on, for the badge on the button. Counted against the defaults so
 *  the badge means "you have changed something", not "layers exist". */
export function changedFromDefault(prefs: LayerPrefs): number {
  return OVERLAYS.filter((o) => prefs[o.id] !== DEFAULT_LAYERS[o.id]).length;
}
