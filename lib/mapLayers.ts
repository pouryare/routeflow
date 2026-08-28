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
  | "mt-satellite";

/** "base" carries street and place names; "imagery" is photography and never does. The
 *  panel offers the names overlay only over imagery. */
export type BasemapKind = "base" | "imagery";

/** A CSS class the map puts on the tile layer to tone raw OpenStreetMap into a look it
 *  has no hosted tiles for. Only the three fallback styles use one -- see globals.css. */
export type ToneClass = "tiles-quiet" | "tiles-radar" | "tiles-apple";

export interface BasemapDef {
  id: BasemapId;
  label: string;
  icon: string;
  hint: string;
  url: string;
  attribution: string;
  /** Leaflet subdomain rotation, where the provider uses it. */
  subdomains?: string;
  maxZoom: number;
  /** Whether the tiles already carry street and place names. When they do, the separate
   *  names overlay is redundant and the panel says so instead of offering it twice. */
  hasLabels: boolean;
  kind: BasemapKind;
  toneClass?: ToneClass;
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

/** Tile-provider API keys, read from NEXT_PUBLIC_ env at build time. Each is optional:
 *  a style that needs a missing key is dropped from the catalogue, never shown broken.
 *
 *  CARTO is deliberately absent. Its dark_all/voyager raster tiles are the pre-redesign
 *  look, but carto.com now stamps "API KEY REQUIRED" across every unkeyed tile, and the
 *  token their free signup issues authorises the CARTO data API -- not the basemap CDN,
 *  which ignores it and keeps stamping. Getting the real tiles back needs a paid CARTO
 *  basemap plan. Stadia's alidade_smooth_dark is the closest hosted stand-in and is what
 *  «رادار» now uses. */
export interface ProviderKeys {
  maptiler?: string;
  stadia?: string;
}

export function envProviderKeys(): ProviderKeys {
  return {
    maptiler: process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined,
    stadia: process.env.NEXT_PUBLIC_STADIA_KEY || undefined,
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
  const { maptiler: mt, stadia: st } = keys;

  // «رادار»: the pre-redesign dark map. Stadia's dark cartography first, MapTiler's next,
  // and a CSS inversion of OSM as the last resort -- that inversion is the reason «رادار»
  // ever looked wrong, so it is only ever the fallback now.
  const radar: BasemapDef = st
    ? {
        id: "radar", label: "رادار", icon: "◎", kind: "base", hasLabels: true, maxZoom: 20,
        url: stadia("alidade_smooth_dark", st), attribution: STADIA_ATTRIBUTION,
        hint: "نمای تیرهٔ کارتوگرافی — زمینهٔ آرام و پرکنتراست، برای شب و برای دیده‌شدن رنگ وضعیت‌ها.",
      }
    : mt
      ? {
          id: "radar", label: "رادار", icon: "◎", kind: "base", hasLabels: true, maxZoom: 20,
          url: maptiler("dataviz-dark", mt), attribution: MAPTILER_ATTRIBUTION,
          hint: "نمای تیرهٔ کارتوگرافی — زمینهٔ آرام و پرکنتراست، برای شب و برای دیده‌شدن رنگ وضعیت‌ها.",
        }
      : {
          id: "radar", label: "رادار", icon: "◎", kind: "base", hasLabels: true, maxZoom: 19,
          url: OSM_URL, attribution: OSM_ATTRIBUTION, toneClass: "tiles-radar",
          hint: "نمای تیرهٔ قبلی — وارونه‌سازی نقشهٔ روشن. برای نمای کارتوگرافی واقعی، کلید نقشه لازم است.",
        };

  // «روشن»: the Apple-Maps-like soft light look. Stadia's Alidade Smooth is near-identical
  // to it; MapTiler Basic is the next best; a warm CSS tone on OSM is the fallback.
  const apple: BasemapDef = st
    ? {
        id: "apple", label: "روشن", icon: "▤", kind: "base", hasLabels: true, maxZoom: 20,
        url: stadia("alidade_smooth", st), attribution: STADIA_ATTRIBUTION,
        hint: "روشن، نرم و کم‌رنگ — شبیه نقشهٔ اپل. برای روز و برای چاپ.",
      }
    : mt
      ? {
          id: "apple", label: "روشن", icon: "▤", kind: "base", hasLabels: true, maxZoom: 20,
          url: maptiler("basic-v2", mt), attribution: MAPTILER_ATTRIBUTION,
          hint: "روشن، نرم و کم‌رنگ — شبیه نقشهٔ اپل. برای روز و برای چاپ.",
        }
      : {
          id: "apple", label: "روشن", icon: "▤", kind: "base", hasLabels: true, maxZoom: 19,
          url: OSM_URL, attribution: OSM_ATTRIBUTION, toneClass: "tiles-apple",
          hint: "روشن و کم‌رنگ. برای نمای نرم‌تر شبیه اپل، کلید نقشه لازم است.",
        };

  const list: BasemapDef[] = [
    {
      /* The id stays "dark" even though the tiles are not: renaming it would silently
         reset the basemap for everyone who has ever chosen one. */
      id: "dark", label: "آرام", icon: "🌙", kind: "base", hasLabels: true, maxZoom: 19,
      url: OSM_URL, attribution: OSM_ATTRIBUTION, toneClass: "tiles-quiet",
      hint: "کم‌رنگ، تا رنگ‌های مشتری‌ها و مناطق دیده شوند. با تم روشن و تیره هماهنگ می‌شود.",
    },
    radar,
    apple,
    {
      id: "streets", label: "خیابانی", icon: "🛣", kind: "base", hasLabels: true, maxZoom: 19,
      url: OSM_URL, attribution: OSM_ATTRIBUTION,
      hint: "نام کامل خیابان‌ها و محله‌ها به فارسی، با رنگ کامل.",
    },
    {
      id: "satellite", label: "ماهواره‌ای", icon: "🛰", kind: "imagery", hasLabels: false, maxZoom: 19,
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      hint: "برای شناختن ساختمان و ورودی. هیچ نامی روی خودش ندارد — لایه نام‌ها را روشن کنید.",
    },
    {
      id: "topo", label: "توپوگرافی", icon: "⛰", kind: "base", hasLabels: true, maxZoom: 19,
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution: `${ESRI_ATTRIBUTION} — Esri, HERE, Garmin, USGS, NGA`,
      hint: "خطوط ارتفاع و ناهمواری، با نام خیابان‌ها. برای دامنه‌های شمال شهر.",
    },
    {
      id: "hot", label: "بشردوستانه", icon: "✚", kind: "base", hasLabels: true, maxZoom: 19,
      url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", subdomains: "ab",
      attribution: `${OSM_ATTRIBUTION} — tiles courtesy of <a href="https://www.hotosm.org/">HOT</a>`,
      hint: "پرکنتراست، با تأکید بر جزئیات شهری. خوانا روی اینترنت ضعیف.",
    },
  ];

  if (st) {
    list.push(
      {
        id: "toner", label: "سیاه‌وسفید", icon: "◐", kind: "base", hasLabels: true, maxZoom: 20,
        url: stadia("stamen_toner", st), attribution: STAMEN_ATTRIBUTION,
        hint: "کنتراست بالا و بدون رنگ — برای وقتی رنگِ داده‌ها باید تنها رنگِ صفحه باشد.",
      },
      {
        id: "terrain", label: "زمین", icon: "⛰", kind: "base", hasLabels: true, maxZoom: 18,
        url: stadia("stamen_terrain", st), attribution: STAMEN_ATTRIBUTION,
        hint: "ناهمواری و پوشش گیاهی با سایه‌پردازی. برای حاشیهٔ کوهستانی شهر.",
      },
      {
        id: "watercolor", label: "آبرنگ", icon: "❋", kind: "base", hasLabels: true, maxZoom: 16,
        url: stadia("stamen_watercolor", st, "jpg"), attribution: STAMEN_ATTRIBUTION,
        hint: "نمای هنری، برای ارائه و تصویر — نه برای پیدا کردن یک در.",
      },
    );
  }
  if (mt) {
    list.push(
      {
        id: "mt-basic", label: "ساده", icon: "▢", kind: "base", hasLabels: true, maxZoom: 20,
        url: maptiler("basic-v2", mt), attribution: MAPTILER_ATTRIBUTION,
        hint: "روشن و مینیمال، با رنگ‌های ملایم.",
      },
      {
        id: "mt-streets", label: "خیابانی روشن", icon: "🛣", kind: "base", hasLabels: true, maxZoom: 20,
        url: maptiler("streets-v2", mt), attribution: MAPTILER_ATTRIBUTION,
        hint: "خیابان‌ها با رنگ‌بندی کامل و برچسب‌های واضح.",
      },
      {
        id: "mt-outdoor", label: "طبیعت‌گردی", icon: "🌲", kind: "base", hasLabels: true, maxZoom: 20,
        url: maptiler("outdoor-v2", mt), attribution: MAPTILER_ATTRIBUTION,
        hint: "مسیرها، ارتفاع و پوشش گیاهی — برای بیرون از بافت شهری.",
      },
      {
        id: "mt-satellite", label: "ماهواره‌ای (نو)", icon: "🛰", kind: "imagery", hasLabels: false, maxZoom: 20,
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
  icon: string;
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
    icon: "🔤",
    hint: "روی نقشه تیره و ماهواره‌ای. نقشه خیابانی خودش نام دارد.",
    group: "names",
  },
  {
    id: "traffic_zone",
    label: "محدوده طرح ترافیک",
    icon: "⛔",
    hint: "محدوده مرکزی. در ساعت طرح بدون مجوز نمی‌شود وارد شد.",
    group: "restrictions",
  },
  {
    id: "low_emission",
    label: "محدوده کنترل آلودگی هوا",
    icon: "🌫",
    hint: "محدوده بزرگ‌تر بیرونی (همت، بعثت، امام علی، نواب/چمران). ورود در ساعت طرح، یک روز از سهمیه فصلی کم می‌کند.",
    group: "restrictions",
  },
  {
    id: "customers",
    label: "مشتریان",
    icon: "📍",
    hint: "پین همه مشتری‌های فیلترشده.",
    group: "data",
  },
  {
    id: "districts",
    label: "مناطق و محله‌ها",
    icon: "🗺",
    hint: "مرز و رنگ وضعیت پوشش.",
    group: "data",
  },
  {
    id: "facilities",
    label: "انبار و مبدأ",
    icon: "🏢",
    hint: "جایگاه‌های خودمان.",
    group: "data",
  },
  {
    id: "heatmap",
    label: "نقشه حرارتی",
    icon: "🔥",
    hint: "تراکم مشتری‌ها.",
    group: "data",
  },
  {
    id: "corridor",
    label: "کریدور بین انبارها",
    icon: "🛣",
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
