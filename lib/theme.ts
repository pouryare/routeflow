/** Theme selection, persisted per browser.
 *
 *  Dark is the product's identity, not merely its default -- the map, the markers and the
 *  status glows are all tuned for a near-black ground, and it is what the app looks like
 *  in a vehicle at night. Light is a first-class equal with its own palette and its own
 *  elevation model (see MASTER.md), but it is opt-in.
 */
export type Theme = "dark" | "light";

export const THEME_KEY = "coverage-theme";
/** The same stored preference, surfaced to /sales under its own attribute.
 *
 *  The map reads `data-theme`, where dark is the ABSENCE of the attribute. The کارگاه
 *  scope needs a positive signal for dark instead, because `.kargah` defaults to light
 *  and its dark block is selected by `:root[data-skin="dark"] .kargah`. Writing both
 *  from one place is what stops the two scopes drifting apart. */
export const SKIN_KEY = THEME_KEY;
export const DEFAULT_THEME: Theme = "dark";
export const THEME_CHANGE_EVENT = "coverage-theme-change";

export function isTheme(v: unknown): v is Theme {
  return v === "dark" || v === "light";
}

/** Runs before first paint, from a blocking inline script in the root layout.
 *
 *  Two things have to be true and neither survives being done in React. The attribute has
 *  to be on <html> before the browser paints, or every load of a light-mode session starts
 *  with a black flash. And the OS preference has to be read *once* and then written down:
 *  a delivery app that flipped to light under the driver at sunrise, because the phone
 *  decided to, would be changing the interface of someone who is driving. So the OS is a
 *  first-run guess that immediately becomes a stored choice, and after that only the
 *  toggle moves it.
 *
 *  Everything is inside try/catch because localStorage throws outright in a private
 *  window on some browsers, and a theme preference is never worth a blank page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_KEY)},s=localStorage.getItem(k);
if(s!=="dark"&&s!=="light"){s=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";localStorage.setItem(k,s);}
document.documentElement.setAttribute("data-skin",s);
if(s==="light"){document.documentElement.setAttribute("data-theme","light");
var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f1f4f7");}
}catch(e){}})();`;

/** Writes the choice and tells every mounted consumer in this tab.
 *
 *  localStorage fires no storage event in the tab that wrote it, so without the custom
 *  event a toggle in the header would not reach a second copy of the control in settings.
 *  Same missing half that lib/navApps' consumers work around.
 */
/** Canvas colours, duplicated from globals.css for the one consumer that cannot read CSS:
 *  the browser's own chrome. Kept next to each other so a change to either is obvious. */
const THEME_COLOR: Record<Theme, string> = { dark: "#0a0e14", light: "#f1f4f7" };

export function applyTheme(theme: Theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");

  // Positive on both sides, unlike data-theme -- see SKIN_KEY.
  document.documentElement.setAttribute("data-skin", theme);

  // Keeps the phone's status bar and the PWA's title bar in step. Installed to the home
  // screen this is the difference between the app filling the notch area and a black band
  // across the top of a light-mode session.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private-window storage denial. The attribute is already set, so the choice holds
    // for this page; it just will not survive a reload.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
