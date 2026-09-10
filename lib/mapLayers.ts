import type { IconName } from "@/components/meridian/icon-map";
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
  | "dark"
  | "radar"
  | "apple"
  | "streets"
  | "satellite"
  | "topo"
  | "hot"
  | "toner"
  | "terrain"
  | "watercolor"
  | "mt-basic"
  | "mt-streets"
  | "mt-outdoor"
  | "mt-satellite"
  | "positron"
  | "voyager"
  | "radar-plain"
  | "positron-plain"
  | "voyager-plain";

/** "base" carries street and place names; "imagery" is photography and never does. The
 *  panel offers the names overlay only over imagery. */
export type BasemapKind = "base" | "imagery";

/** What the basemap's ground looks like, which decides how the app's own overlays are
 *  inked on top of it -- see MAP_INK in components/CoverageMap.tsx and the
 *  `[data-ground]` blocks in globals.css. Independent of the page theme: choosing a cream
 *  basemap on a dark skin has to lighten the district strokes, or they vanish. */
export type BasemapGround = "dark" | "light";

/** A CSS class the map puts on the tile layer to tone raw OpenStreetMap into a look it
 *  has no hosted tiles for. Only the raster fallback styles use one -- see globals.css. */
export type ToneClass = "tiles-quiet" | "tiles-radar" | "tiles-apple";

/** The raster layer drawn when a vector style cannot be used -- no WebGL, or MapLibre
 *  failed to load. Not a second look on purpose: it is the same reading of the city on
 *  tiles that need no GPU. */
export interface RasterFallback {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  toneClass?: ToneClass;
}

export interface BasemapDef {
  id: BasemapId;
  label: string;
  icon: IconName;
  hint: string;
  /** Raster tile template. Empty for a vector style, which draws from `styleUrl`. */
  url: string;
  attribution: string;
  /** Leaflet subdomain rotation, where the provider uses it. */
  subdomains?: string;
  maxZoom: number;
  /** Whether the tiles already carry street and place names. When they do, the separate
   *  names overlay is redundant and the panel says so instead of offering it twice. */
  hasLabels: boolean;
  kind: BasemapKind;
  ground: BasemapGround;
  toneClass?: ToneClass;
  /** A MapLibre GL style document. When set, the map draws this through MapLibre instead
   *  of a raster TileLayer, and `url` is empty. */
  styleUrl?: string;
  /** Required whenever `styleUrl` is set. */
  rasterFallback?: RasterFallback;
}

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTRIBUTION = "Tiles &copy; Esri";
const STADIA_ATTRIBUTION =
  '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; OpenStreetMap contributors';
const STAMEN_ATTRIBUTION =
  `${STADIA_ATTRIBUTION} &copy; <a href="https://stamen.com/">Stamen Design</a>`;
const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors';

const stadia = (style: string, key: string, ext = "png") =>
  `https://tiles.stadiamaps.com/tiles/${style}/{z}/{x}/{y}.${ext}?api_key=${key}`;
/** MapTiler serves 512px tiles at the bare path; the /256/ path is what Leaflet's default
 *  tile grid expects, so every other basemap here lines up without a tileSize override. */
const maptiler = (style: string, key: string, ext = "png") =>
  `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.${ext}?key=${key}`;

/** CARTO's basemaps, which is where «رادار» comes from.
 *
 *  Two services, one key. A CARTO *Basemaps* key (`cb1_...`) is not the token their data
 *  warehouse issues: the warehouse token is ignored by the basemap CDN entirely -- a tile
 *  fetched with it and without it come back byte-identical, watermarked both ways. That
 *  dead end is why this went to vector in the first place.
 *
 *  - Raster needs the key today; it is what clears the "API KEY REQUIRED" watermark.
 *  - Vector does not need it yet, but CARTO have said the requirement is coming, so it is
 *    sent on the style, tile, glyph and sprite requests now. Sending it early is
 *    harmless: the endpoints already accept and ignore it.
 *
 *  Vector is the default anyway, and not only because it was the way in before the key
 *  arrived: CARTO are retiring raster, and it stays sharp at any zoom, which matters for
 *  an app used to find a shop's door. Raster is the no-WebGL fallback. */
const cartoKeyed = (url: string, key?: string) =>
  key ? `${url}${url.includes("?") ? "&" : "?"}key=${key}` : url;
const cartoGl = (style: string, key?: string) =>
  cartoKeyed(`https://basemaps.cartocdn.com/gl/${style}/style.json`, key);
const cartoRaster = (style: string, key?: string) =>
  cartoKeyed(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`, key);
/** CARTO's free tier is explicitly in exchange for keeping this visible. */
const CARTO_ATTRIBUTION =
  `&copy; <a href="https://carto.com/attributions">CARTO</a> ${OSM_ATTRIBUTION}`;

/** Tile-provider API keys, read from NEXT_PUBLIC_ env at build time. Each is optional:
 *  a style that needs a missing key is dropped from the catalogue, never shown broken. */
export interface ProviderKeys {
  maptiler?: string;
  stadia?: string;
  carto?: string;
}

export function envProviderKeys(): ProviderKeys {
  return {
    maptiler: process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined,
    stadia: process.env.NEXT_PUBLIC_STADIA_KEY || undefined,
    carto: process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY || undefined,
  };
}

/** The quiet OpenStreetMap basemap, shared with the small maps elsewhere (lead map, pin
 *  picker, route preview) so they stop pulling CARTO's watermarked dark tiles. */
export const QUIET_TILES = {
  url: OSM_URL,
  attribution: OSM_ATTRIBUTION,
  subdomains: undefined as string | undefined,
  maxZoom: 19,
};

/** Build the basemap catalogue for a given set of provider keys. Pure and key-driven so
 *  the ordering, labels and per-key gating can be tested without a browser or env.
 *
 *  The ids `dark`, `radar` and `apple` are stable across key changes -- they are what is
 *  written to localStorage under BASEMAP_KEY -- while the tiles behind `radar` and
 *  `apple` upgrade from a CSS tone on OSM to a hosted style as keys become available. */
export function buildBasemaps(keys: ProviderKeys = {}): BasemapDef[] {
  const { maptiler: mt, stadia: st, carto: ck } = keys;

  /* The raster drawn if MapLibre cannot run (no WebGL, or the chunk fails to load).
     With a CARTO key this is CARTO's own raster of the same cartography, so the fallback
     is the same map rather than a different one -- which is the whole reason to prefer it
     over the other providers' near-equivalents. Then the best hosted stand-in, and only
     as a true last resort CSS-toned OSM. */
  const darkFallback: RasterFallback = ck
    ? { url: cartoRaster("dark_all", ck), attribution: CARTO_ATTRIBUTION, subdomains: "abcd", maxZoom: 20 }
    : st
      ? { url: stadia("alidade_smooth_dark", st), attribution: STADIA_ATTRIBUTION, maxZoom: 20 }
      : mt
        ? { url: maptiler("dataviz-dark", mt), attribution: MAPTILER_ATTRIBUTION, maxZoom: 20 }
        : { url: OSM_URL, attribution: OSM_ATTRIBUTION, maxZoom: 19, toneClass: "tiles-radar" };

  const lightFallback: RasterFallback = ck
    ? { url: cartoRaster("light_all", ck), attribution: CARTO_ATTRIBUTION, subdomains: "abcd", maxZoom: 20 }
    : st
      ? { url: stadia("alidade_smooth", st), attribution: STADIA_ATTRIBUTION, maxZoom: 20 }
      : mt
        ? { url: maptiler("basic-v2", mt), attribution: MAPTILER_ATTRIBUTION, maxZoom: 20 }
        : { url: OSM_URL, attribution: OSM_ATTRIBUTION, maxZoom: 19, toneClass: "tiles-apple" };

  const list: BasemapDef[] = [
    {
      /* The id stays "dark" even though the tiles are not: renaming it would silently
         reset the basemap for everyone who has ever chosen one. */
      id: "dark", label: "آرام", icon: "moon", kind: "base", ground: "dark", hasLabels: true, maxZoom: 19,
      url: OSM_URL, attribution: OSM_ATTRIBUTION, toneClass: "tiles-quiet",
      hint: "کم‌رنگ، تا رنگ‌های مشتری‌ها و مناطق دیده شوند. با تم روشن و تیره هماهنگ می‌شود.",
    },
    {
      /* The pre-redesign map itself, not a stand-in for it: CARTO Dark Matter, drawn as
         vector through MapLibre because their raster CDN is watermarked. */
      id: "radar", label: "رادار", icon: "radar", kind: "base", ground: "dark", hasLabels: true, maxZoom: 20,
      url: "", styleUrl: cartoGl("dark-matter-gl-style", ck), attribution: CARTO_ATTRIBUTION,
      rasterFallback: darkFallback,
      hint: "همان نمای تیرهٔ قبلی — زمینهٔ نزدیک به سیاه با خیابان‌های نازک. برای شب و برای دیده‌شدن رنگ وضعیت‌ها.",
    },
    {
      id: "apple", label: "روشن", icon: "sun", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
      ...(st
        ? { url: stadia("alidade_smooth", st), attribution: STADIA_ATTRIBUTION }
        : mt
          ? { url: maptiler("basic-v2", mt), attribution: MAPTILER_ATTRIBUTION }
          : { url: OSM_URL, attribution: OSM_ATTRIBUTION, toneClass: "tiles-apple" as ToneClass }),
      hint: "روشن، نرم و کم‌رنگ — شبیه نقشهٔ اپل. برای روز و برای چاپ.",
    },
    {
      id: "positron", label: "سپید", icon: "dot", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
      url: "", styleUrl: cartoGl("positron-gl-style", ck), attribution: CARTO_ATTRIBUTION,
      rasterFallback: lightFallback,
      hint: "بسیار روشن و کم‌جزئیات — کم‌سروصداترین زمینه برای وقتی داده‌ها شلوغ‌اند.",
    },
    {
      id: "voyager", label: "رنگی", icon: "palette", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
      url: "", styleUrl: cartoGl("voyager-gl-style", ck), attribution: CARTO_ATTRIBUTION,
      rasterFallback: lightFallback,
      hint: "متعادل و رنگی، با خیابان‌ها و کاربری‌های متمایز. نمای همه‌منظورهٔ روز.",
    },
    {
      id: "radar-plain", label: "رادار (بی‌نام)", icon: "radar", kind: "base", ground: "dark", hasLabels: false, maxZoom: 20,
      url: "", styleUrl: cartoGl("dark-matter-nolabels-gl-style", ck), attribution: CARTO_ATTRIBUTION,
      rasterFallback: darkFallback,
      hint: "رادار بدون هیچ نامی — وقتی برچسب‌های خود نقشه با نام مشتری‌ها تداخل دارند.",
    },
    {
      id: "positron-plain", label: "سپید (بی‌نام)", icon: "dot", kind: "base", ground: "light", hasLabels: false, maxZoom: 20,
      url: "", styleUrl: cartoGl("positron-nolabels-gl-style", ck), attribution: CARTO_ATTRIBUTION,
      rasterFallback: lightFallback,
      hint: "سپید بدون نام. خلوت‌ترین زمینهٔ ممکن زیر مرزها و پین‌ها.",
    },
    {
      id: "voyager-plain", label: "رنگی (بی‌نام)", icon: "palette", kind: "base", ground: "light", hasLabels: false, maxZoom: 20,
      url: "", styleUrl: cartoGl("voyager-nolabels-gl-style", ck), attribution: CARTO_ATTRIBUTION,
      rasterFallback: lightFallback,
      hint: "رنگی بدون نام — شکل شهر بدون متن.",
    },
    {
      id: "streets", label: "خیابانی", icon: "route", kind: "base", ground: "light", hasLabels: true, maxZoom: 19,
      url: OSM_URL, attribution: OSM_ATTRIBUTION,
      hint: "نام کامل خیابان‌ها و محله‌ها به فارسی، با رنگ کامل.",
    },
    {
      id: "satellite", label: "ماهواره‌ای", icon: "satellite", kind: "imagery", ground: "dark", hasLabels: false, maxZoom: 19,
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      hint: "برای شناختن ساختمان و ورودی. هیچ نامی روی خودش ندارد — لایه نام‌ها را روشن کنید.",
    },
    {
      id: "topo", label: "توپوگرافی", icon: "mountain", kind: "base", ground: "light", hasLabels: true, maxZoom: 19,
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution: `${ESRI_ATTRIBUTION} — Esri, HERE, Garmin, USGS, NGA`,
      hint: "خطوط ارتفاع و ناهمواری، با نام خیابان‌ها. برای دامنه‌های شمال شهر.",
    },
    {
      id: "hot", label: "بشردوستانه", icon: "plus", kind: "base", ground: "light", hasLabels: true, maxZoom: 19,
      url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", subdomains: "ab",
      attribution: `${OSM_ATTRIBUTION} — tiles courtesy of <a href="https://www.hotosm.org/">HOT</a>`,
      hint: "پرکنتراست، با تأکید بر جزئیات شهری. خوانا روی اینترنت ضعیف.",
    },
  ];

  if (st) {
    list.push(
      {
        id: "toner", label: "سیاه‌وسفید", icon: "contrast", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
        url: stadia("stamen_toner", st), attribution: STAMEN_ATTRIBUTION,
        hint: "کنتراست بالا و بدون رنگ — برای وقتی رنگِ داده‌ها باید تنها رنگِ صفحه باشد.",
      },
      {
        id: "terrain", label: "زمین", icon: "mountain", kind: "base", ground: "light", hasLabels: true, maxZoom: 18,
        url: stadia("stamen_terrain", st), attribution: STAMEN_ATTRIBUTION,
        hint: "ناهمواری و پوشش گیاهی با سایه‌پردازی. برای حاشیهٔ کوهستانی شهر.",
      },
      {
        id: "watercolor", label: "آبرنگ", icon: "sparkle", kind: "base", ground: "light", hasLabels: true, maxZoom: 16,
        url: stadia("stamen_watercolor", st, "jpg"), attribution: STAMEN_ATTRIBUTION,
        hint: "نمای هنری، برای ارائه و تصویر — نه برای پیدا کردن یک در.",
      },
    );
  }
  if (mt) {
    list.push(
      {
        id: "mt-basic", label: "ساده", icon: "square", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
        url: maptiler("basic-v2", mt), attribution: MAPTILER_ATTRIBUTION,
        hint: "روشن و مینیمال، با رنگ‌های ملایم.",
      },
      {
        id: "mt-streets", label: "خیابانی روشن", icon: "route", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
        url: maptiler("streets-v2", mt), attribution: MAPTILER_ATTRIBUTION,
        hint: "خیابان‌ها با رنگ‌بندی کامل و برچسب‌های واضح.",
      },
      {
        id: "mt-outdoor", label: "طبیعت‌گردی", icon: "trees", kind: "base", ground: "light", hasLabels: true, maxZoom: 20,
        url: maptiler("outdoor-v2", mt), attribution: MAPTILER_ATTRIBUTION,
        hint: "مسیرها، ارتفاع و پوشش گیاهی — برای بیرون از بافت شهری.",
      },
      {
        id: "mt-satellite", label: "ماهواره‌ای (نو)", icon: "satellite", kind: "imagery", ground: "dark", hasLabels: false, maxZoom: 20,
        url: maptiler("satellite", mt, "jpg"), attribution: MAPTILER_ATTRIBUTION,
        hint: "تصویر ماهواره‌ای مپ‌تایلر — در برخی نواحی تازه‌تر از نسخهٔ Esri.",
      },
    );
  }
  return list;
}

export const BASEMAPS: BasemapDef[] = buildBasemaps(envProviderKeys());

export function basemapDef(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function isBasemapId(v: unknown): v is BasemapId {
  return typeof v === "string" && BASEMAPS.some((b) => b.id === v);
}

/** Persian street and place names as a transparent overlay, for the imagery basemaps.
 *
 *  Only "imagery" kinds need it: every "base" style carries its own names. This is Esri's
 *  reference layer, drawn light for a dark ground, so it reads over photography without
 *  any CSS inversion.
 *
 *  It stops at z18 where the imagery goes to z19; Leaflet simply draws no names on that
 *  last step rather than erroring. */
export const LABELS_TILE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  attribution: "Labels &copy; Esri",
  subdomains: undefined as string | undefined,
  maxZoom: 18,
};

export type OverlayId =
  | "labels"
  | "traffic_zone"
  | "low_emission"
  | "districts"
  | "customers"
  | "facilities"
  | "heatmap"
  | "corridor";

export type OverlayGroup = "names" | "restrictions" | "data";

export interface OverlayDef {
  id: OverlayId;
  label: string;
  icon: IconName;
  hint: string;
  group: OverlayGroup;
}

export const OVERLAY_GROUPS: { id: OverlayGroup; label: string }[] = [
  { id: "names", label: "نام‌ها" },
  { id: "restrictions", label: "محدودیت‌های ترافیکی" },
  { id: "data", label: "داده‌های شما" },
];

export const OVERLAYS: OverlayDef[] = [
  {
    id: "labels",
    label: "نام خیابان‌ها و محله‌ها",
    icon: "labels",
    hint: "روی نقشه تیره و ماهواره‌ای. نقشه خیابانی خودش نام دارد.",
    group: "names",
  },
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
  labels: false,
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
 *  own basemap, dark starts on «آرام» and light on «روشن», and flipping the skin swaps
 *  between the two. Picking a basemap from the layers panel changes only the current
 *  skin's choice. */
export type BasemapBySkin = { dark: BasemapId; light: BasemapId };
export const DEFAULT_BASEMAPS: BasemapBySkin = { dark: "dark", light: "apple" };
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
