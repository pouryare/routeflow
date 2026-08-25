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

export type BasemapId = "dark" | "streets" | "satellite";

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
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const BASEMAPS: BasemapDef[] = [
  {
    id: "dark",
    label: "تیره",
    icon: "🌙",
    hint: "کم‌رنگ، تا رنگ‌های مشتری‌ها و مناطق دیده شوند.",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
    subdomains: "abcd",
    maxZoom: 20,
    // dark_all does carry labels, but sparsely: it drops most street names to keep the
    // basemap quiet. That is the gap the names overlay fills.
    hasLabels: false,
  },
  {
    id: "streets",
    label: "خیابانی",
    icon: "🛣",
    hint: "نام کامل خیابان‌ها و محله‌ها به فارسی. روشن است و رنگ‌های نقشه را کم‌رنگ‌تر نشان می‌دهد.",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
    hasLabels: true,
  },
  {
    id: "satellite",
    label: "ماهواره‌ای",
    icon: "🛰",
    hint: "برای شناختن ساختمان و ورودی. هیچ نامی روی خودش ندارد — لایه نام‌ها را روشن کنید.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
    hasLabels: false,
  },
];

export function basemapDef(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function isBasemapId(v: unknown): v is BasemapId {
  return typeof v === "string" && BASEMAPS.some((b) => b.id === v);
}

/** Persian street and place names as a transparent overlay.
 *
 *  CARTO's own "light" label tiles are slate grey and its "dark" ones are near-black --
 *  both drawn to sit on a pale basemap, and both unreadable on this app's dark map or on
 *  satellite imagery. Inverting the near-black set in CSS turns the text near-white and
 *  leaves the transparency alone, which is what `.tiles-inverted` in globals.css does. */
export const LABELS_TILE = {
  url: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
  attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  subdomains: "abcd",
  maxZoom: 20,
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
