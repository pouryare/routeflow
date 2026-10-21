"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** Where a bottom sheet is drawn: the `.meridian` root, which is also where the sheet styles
 *  are scoped (`.meridian .sheet …`).
 *
 *  A sheet is `position: fixed; bottom: 0`, but a fixed element is placed against its nearest
 *  ancestor that has a `transform`, not against the screen. The cards the sheets are opened
 *  from carry one — the scroll-reveal animation leaves a `transform` on every card — so a sheet
 *  rendered inside a card opened at the bottom of that card: 6 800 px down a long orders list,
 *  nowhere near the screen. Drawing it in the root puts it back where it belongs.
 *
 *  null on the server and during hydration, which is fine: a sheet starts closed.
 */
const host = () => document.querySelector<HTMLElement>(".meridian") ?? document.body;

export function useSheetHost(): HTMLElement | null {
  return useSyncExternalStore(noSubscribe, host, () => null);
}
