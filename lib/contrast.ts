/** The "high contrast" choice (for glare, outdoors), persisted per browser.
 *
 *  The same shape as lib/font.ts and for the same reasons: the attribute has to be on <html>
 *  before the first paint, and localStorage fires no storage event in the tab that wrote it,
 *  so a custom event carries same-tab changes to every mounted switch. The values themselves
 *  live in app/globals.css under `:root[data-contrast="high"]`. */

export const CONTRAST_KEY = "coverage-contrast";
export const CONTRAST_CHANGE_EVENT = "coverage-contrast-change";

export const CONTRAST_INIT_SCRIPT = `(function(){try{
if(localStorage.getItem(${JSON.stringify(CONTRAST_KEY)})==="high")document.documentElement.setAttribute("data-contrast","high");
}catch(e){}})();`;

export function applyContrast(high: boolean) {
  if (high) document.documentElement.setAttribute("data-contrast", "high");
  else document.documentElement.removeAttribute("data-contrast");
  try {
    if (high) localStorage.setItem(CONTRAST_KEY, "high");
    else localStorage.removeItem(CONTRAST_KEY);
  } catch {
    // Private-window storage denial: the attribute is set, so the choice holds for this page.
  }
  window.dispatchEvent(new Event(CONTRAST_CHANGE_EVENT));
}

export function readContrast(): boolean {
  try {
    return localStorage.getItem(CONTRAST_KEY) === "high";
  } catch {
    return false;
  }
}
