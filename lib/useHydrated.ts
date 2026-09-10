"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** False during the server render and the hydrating render, true on every client render
 *  after that.
 *
 *  For state that can only be known in the browser (a value in localStorage, a query
 *  string on a prerendered page): read it once `hydrated` turns true and adopt it during
 *  render behind a "restored" flag. The first client render still matches the server's
 *  HTML, and no effect sets state on mount, which is what nine components used to do
 *  behind an `eslint-disable` for react-hooks/set-state-in-effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
