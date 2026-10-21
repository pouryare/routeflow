/** The initial state for a page whose tap flow can be opened by a link (`?new=1`): the phone's
 *  «+ ثبت» sheet sends you to the page with the parameter, and the page opens its own flow on
 *  arrival, so there is one flow per task and the quick action does not carry a copy of it.
 *
 *  Pure: pass `window.location.search` (or "" on the server). The state is the `{ key, open }`
 *  pair the entry components keep; key 1 means "mounted already", 0 means "not yet". */
export function autoOpenFlow(param: string, search: string): { key: number; open: boolean } {
  const on = new URLSearchParams(search).get(param) === "1";
  return { key: on ? 1 : 0, open: on };
}

/** `window.location.search`, safe on the server. */
export const currentSearch = (): string => (typeof window === "undefined" ? "" : window.location.search);
