/** Font-family selection, persisted per browser.
 *
 *  The same shape as lib/accent.ts and for the same reasons -- the attribute has to be on
 *  <html> before the first paint or the page flashes the fallback family, and localStorage
 *  fires no storage event in the tab that wrote it, so a custom event carries same-tab
 *  changes to every mounted copy of the picker.
 *
 *  It is a SEPARATE key from the theme and the accent on purpose: the skin is where you
 *  are, the accent is what colour you like, the font is what letterforms you read best.
 *
 *  The families behind each id are declared in app/fonts.ts; app/globals.css remaps
 *  `--font-ui` / `--font-num` under `:root[data-font="<id>"]`. Nothing here knows a family
 *  name.
 */
import { DEFAULT_FONT, isFontId, type FontId } from "./fontChoices";

export { DEFAULT_FONT, isFontId };
export type { FontId };

export const FONT_KEY = "coverage-font";
export const FONT_CHANGE_EVENT = "coverage-font-change";

/** Runs before first paint, from a blocking inline script in the root layout.
 *
 *  There is no OS preference to consult, so this is only "read the stored choice and
 *  write the attribute". An unknown or absent value writes nothing, which lands on the
 *  bare `:root` block in globals.css -- Peyda, the same family the server rendered, so
 *  there is no mismatch to correct.
 *
 *  Wrapped in try/catch because localStorage throws outright in a private window on some
 *  browsers, and a font preference is never worth a blank page. */
export const FONT_INIT_SCRIPT = `(function(){try{
var f=localStorage.getItem(${JSON.stringify(FONT_KEY)});
if(f)document.documentElement.setAttribute("data-font",f);
}catch(e){}})();`;

export function applyFont(font: FontId) {
  document.documentElement.setAttribute("data-font", font);
  try {
    localStorage.setItem(FONT_KEY, font);
  } catch {
    // Private-window storage denial. The attribute is already set, so the choice holds
    // for this page; it just will not survive a reload.
  }
  window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
}

export function readFont(): FontId {
  try {
    const stored = localStorage.getItem(FONT_KEY);
    return isFontId(stored) ? stored : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}
