// leaflet-geosearch's own SearchResult type lives at a package-internal path that
// isn't reliably resolvable through its published exports map -- only the fields
// actually used here are declared locally instead of depending on that path.
export interface GeoResult {
  x: number; // lng
  y: number; // lat
  label: string;
}

export interface GeoProvider {
  search(opts: { query: string }): Promise<GeoResult[]>;
}

export const URL_RE = /^https?:\/\//i;
export const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export const SORT_OPTIONS = [
  { value: "nearest", label: "نزدیک‌ترین" },
  { value: "score", label: "بهترین امتیاز" },
  { value: "name", label: "نام" },
  { value: "newest", label: "تازه‌ترین" },
  { value: "status", label: "وضعیت" },
  { value: "route", label: "ترتیب مسیر" },
  { value: "priority", label: "اولویت" },
] as const;

export function detectInputType(q: string): "coord" | "address" | "name" {
  const t = q.trim();
  if (COORD_RE.test(t)) return "coord";
  if (t.length >= 2 && /^[آا-یآ\s\-,./]+$/i.test(t) && /\s/.test(t)) return "address";
  return "name";
}

// leaflet-geosearch is only needed once a user actually falls through to an address
// search (no local match found) -- deferred to a dynamic import so its chunk never
// loads for the common case of finding a customer/district locally, and instantiated
// once, on first real use, rather than eagerly for every SearchBox mount.
export let geoProviderPromise: Promise<GeoProvider> | null = null;
export function getGeoProvider(): Promise<GeoProvider> {
  if (!geoProviderPromise) {
    geoProviderPromise = import("leaflet-geosearch").then(
      ({ OpenStreetMapProvider }) =>
        // Iran-biased so a plain place name (e.g. a neighborhood) resolves locally
        // instead of matching a same-named place elsewhere in the world.
        new OpenStreetMapProvider({ params: { countrycodes: "ir", "accept-language": "fa" } }) as GeoProvider
    );
  }
  return geoProviderPromise;
}

// ---- recent searches (localStorage) ----
export const RECENT_KEY = "searchbox_recent";
export const MAX_RECENT = 10;

export function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

export function saveRecent(queries: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(queries)); } catch { /* storage full */ }
}

export function pushRecent(query: string) {
  const q = query.trim();
  if (!q) return;
  const existing = loadRecent().filter((r) => r !== q);
  existing.unshift(q);
  saveRecent(existing.slice(0, MAX_RECENT));
}

export function removeRecent(query: string) {
  saveRecent(loadRecent().filter((r) => r !== query));
}

export function clearAllRecent() {
  localStorage.removeItem(RECENT_KEY);
}

// ---- favorites (localStorage) ----
export interface Favorite {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: "customer" | "district" | "geo";
}

export const FAV_KEY = "searchbox_favorites";

export function loadFavorites(): Favorite[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; }
}

export function saveFavorites(favs: Favorite[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* storage full */ }
}

export function addFavorite(fav: Favorite) {
  const favs = loadFavorites().filter((f) => f.id !== fav.id);
  favs.unshift(fav);
  saveFavorites(favs);
}

export function removeFavorite(id: string) {
  saveFavorites(loadFavorites().filter((f) => f.id !== id));
}

export function isFavorite(id: string): boolean {
  return loadFavorites().some((f) => f.id === id);
}
