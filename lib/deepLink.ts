/** Reading and writing app state in the URL.
 *
 *  The point is that a view becomes a thing you can hand to someone -- paste into a
 *  note, bookmark, send to yourself for the morning. Before this, "the customer I was
 *  looking at" was a place you could only get back to by repeating the clicks.
 *
 *  Two rules the rest of the app depends on:
 *
 *  1. Every parameter is optional and independently valid. A link carrying only `c` is
 *     as legitimate as one carrying `c`, `at` and `color`, and a parameter that fails to
 *     parse is dropped rather than failing the whole URL -- a link that has been through
 *     a chat app and lost a character should still open the map.
 *
 *  2. Writing state back is always history.replaceState, never a push. Panning a map
 *     would otherwise stack a hundred entries and turn the back button into a scrubber.
 */

export const MAP_PARAM = {
  customer: "c",
  district: "d",
  view: "at",
  color: "color",
  districtColor: "dcolor",
} as const;

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export interface MapLinkState {
  customerId?: number;
  districtId?: number;
  view?: MapView;
  /** Left as a string here rather than the CustomerColorMode union: this module has no
   *  business knowing the list of modes, and the caller validates against its own. */
  colorMode?: string;
  /** What the district fill means -- same arrangement, validated by the caller. */
  districtColorMode?: string;
}

// ~1.1 metres at this latitude. Enough to land on the right building, short enough that
// the URL stays something a person can look at.
const COORD_DECIMALS = 5;

function parseIntParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** "35.72977,51.89126,15" -> a view. Rejects anything off the globe, and any zoom
 *  outside what Leaflet is configured to render, rather than passing a nonsense value
 *  to setView and getting a blank map. */
export function parseView(raw: string | null): MapView | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",");
  if (parts.length !== 3) return undefined;
  const [lat, lng, zoom] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  if (zoom < 1 || zoom > 20) return undefined;
  return { lat, lng, zoom };
}

export function formatView(v: MapView): string {
  return `${v.lat.toFixed(COORD_DECIMALS)},${v.lng.toFixed(COORD_DECIMALS)},${Math.round(v.zoom)}`;
}

export function parseMapLink(search: string): MapLinkState {
  const p = new URLSearchParams(search);
  const state: MapLinkState = {};

  const customerId = parseIntParam(p.get(MAP_PARAM.customer));
  if (customerId !== undefined) state.customerId = customerId;

  const districtId = parseIntParam(p.get(MAP_PARAM.district));
  if (districtId !== undefined) state.districtId = districtId;

  const view = parseView(p.get(MAP_PARAM.view));
  if (view) state.view = view;

  const color = p.get(MAP_PARAM.color);
  if (color) state.colorMode = color;

  const districtColor = p.get(MAP_PARAM.districtColor);
  if (districtColor) state.districtColorMode = districtColor;

  return state;
}

/** The query string for a state, leading "?" included, or "" when there is nothing to
 *  say. Parameters are emitted in a fixed order so the same view always produces the
 *  same string -- which is what makes two links comparable by eye. */
export function buildMapLink(state: MapLinkState): string {
  const p = new URLSearchParams();
  if (state.customerId !== undefined) p.set(MAP_PARAM.customer, String(state.customerId));
  if (state.districtId !== undefined) p.set(MAP_PARAM.district, String(state.districtId));
  if (state.view) p.set(MAP_PARAM.view, formatView(state.view));
  if (state.colorMode) p.set(MAP_PARAM.color, state.colorMode);
  if (state.districtColorMode) p.set(MAP_PARAM.districtColor, state.districtColorMode);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Rewrites the address bar in place.
 *
 *  replaceState rather than a router navigation on purpose: this is called as the user
 *  pans, and a real navigation would re-run the route and remount the map under them.
 *  Silently does nothing outside a browser, so callers don't need their own guard. */
export function replaceUrlQuery(query: string): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${query}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

/** The absolute URL for a state -- what the share button puts on the clipboard. */
export function absoluteMapLink(state: MapLinkState, pathname = "/"): string {
  if (typeof window === "undefined") return `${pathname}${buildMapLink(state)}`;
  return `${window.location.origin}${pathname}${buildMapLink(state)}`;
}

/** The single-id case the other pages need: /facilities?f=3, /leads?l=12, /gallery?p=8.
 *  Same tolerance as the map's parser -- a malformed id is simply absent. */
export function parseIdParam(search: string, key: string): number | undefined {
  return parseIntParam(new URLSearchParams(search).get(key));
}
