/** Accent selection, persisted per browser.
 *
 *  The same shape as lib/theme.ts and for the same reasons -- the attribute has to be on
 *  <html> before the first paint or the page flashes the wrong colour, and localStorage
 *  fires no storage event in the tab that wrote it, so a custom event carries same-tab
 *  changes to every mounted copy of the picker.
 *
 *  It is a SEPARATE key from the theme on purpose. Light/dark is about where you are --
 *  a vehicle at night, an office at noon -- and accent is about what you like. Storing
 *  them together would mean picking a colour reset your skin, or the reverse.
 *
 *  The colours behind each id live in app/globals.css under :root[data-accent="..."],
 *  written by scripts/gen-accent-themes.mjs. Nothing here knows a hex value.
 */

import { DEFAULT_ACCENT, isAccentId, type AccentId } from "./accentThemes";

export { DEFAULT_ACCENT, isAccentId };
export type { AccentId };

export const ACCENT_KEY = "coverage-accent";
export const ACCENT_CHANGE_EVENT = "coverage-accent-change";

/** Runs before first paint, from a blocking inline script in the root layout.
 *
 *  Unlike the theme there is no OS preference to consult, so this is only "read the
 *  stored choice and write the attribute". An unknown or absent value writes nothing,
 *  which lands on the default block in globals.css -- the same palette the server
 *  rendered, so there is no mismatch to correct.
 *
 *  Wrapped in try/catch because localStorage throws outright in a private window on some
 *  browsers, and an accent preference is never worth a blank page. */
export const ACCENT_INIT_SCRIPT = `(function(){try{
var a=localStorage.getItem(${JSON.stringify(ACCENT_KEY)});
if(a)document.documentElement.setAttribute("data-accent",a);
}catch(e){}})();`;

export function applyAccent(accent: AccentId) {
  document.documentElement.setAttribute("data-accent", accent);
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Private-window storage denial. The attribute is already set, so the choice holds
    // for this page; it just will not survive a reload.
  }
  window.dispatchEvent(new Event(ACCENT_CHANGE_EVENT));
}

export function readAccent(): AccentId {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    return isAccentId(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}
