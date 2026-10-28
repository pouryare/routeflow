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

/** Address search through Nominatim, for when nothing local matches. Iran-biased so a
 *  plain place name (a neighbourhood) resolves locally instead of matching a same-named
 *  place elsewhere in the world. */
const nominatim: GeoProvider = {
  async search({ query }) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ format: "json", q: query, countrycodes: "ir", "accept-language": "fa" }).toString();
    const res = await fetch(url);
    if (!res.ok) return [];
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    return rows.map((r) => ({ x: Number(r.lon), y: Number(r.lat), label: r.display_name }));
  },
};
export function getGeoProvider(): Promise<GeoProvider> {
  return Promise.resolve(nominatim);
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
