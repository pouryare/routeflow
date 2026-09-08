/** Theme selection, persisted per browser.
 *
 *  Three stored states, not two. "auto" follows the OS live via matchMedia; "light" and
 *  "dark" pin explicitly. Light is the resolved default when nothing is stored and the
 *  OS has no preference either -- this app's identity inverted from dark-default to
 *  light-default in the 2026-09-08 notched-skeuomorphic-substrate redesign.
 *
 *  /driver is the one exception: a moving vehicle must not have its screen change theme
 *  because the OS flipped under the driver's thumb, so it ignores "auto" and pins to
 *  whatever was explicitly chosen, defaulting to dark if nothing was.
 */
export type Theme = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "routeflow-theme";
/** The same stored preference, ALSO surfaced under this attribute -- still needed
 *  because the accent-theme generator's per-theme dark variants
 *  (scripts/gen-accent-themes.mjs, app/globals.css's ACCENT-THEMES block) key on
 *  data-skin="dark" for the map, not on data-theme. Writing both from one place is what
 *  stops the two attributes drifting apart; see MASTER.md-successor notes on the
 *  substrate redesign for why data-theme alone was not enough to retire this. */
export const SKIN_KEY = THEME_KEY;
export const THEME_CHANGE_EVENT = "routeflow-theme-change";

export function isTheme(v: unknown): v is Theme {
  return v === "auto" || v === "light" || v === "dark";
}

/** Pure resolution: given what is stored, what the OS currently prefers, and whether
 *  this route is /driver, decides the actual light/dark to render. No I/O -- the caller
 *  (the init script, and any live matchMedia listener) supplies the inputs. */
export function resolveTheme(
  stored: Theme | null,
  prefersLight: boolean,
  isDriverRoute: boolean,
): ResolvedTheme {
  const effective: Theme = stored ?? "auto";
  if (isDriverRoute && effective === "auto") return "dark";
  if (effective === "light") return "light";
  if (effective === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

/** Canvas colours, duplicated from globals.css for the one consumer that cannot read CSS:
 *  the browser's own chrome. Kept next to each other so a change to either is obvious. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#ECEDEF", dark: "#101215" };

/** Runs before first paint, from a blocking inline script in the root layout.
 *
 *  The attribute has to be on <html> before the browser paints, or every load starting
 *  in the theme the OS or the driver-route rule did not expect flashes the wrong colour
 *  first. Re-reads matchMedia on every load rather than freezing a first-run guess,
 *  because "auto" is meant to track the OS live -- the one carve-out is /driver,
 *  detected here via pathname, which never auto-follows.
 *
 *  data-theme is always written EXPLICITLY as the resolved light/dark value (never left
 *  absent) -- several CSS rules (.elevate-*, .theme-toggle__*, .tiles-quiet) key on
 *  [data-theme="light"] being present, not merely on :root's default. data-skin mirrors
 *  it for the still-unmigrated accent-theme generator (see SKIN_KEY).
 *
 *  Everything is inside try/catch because localStorage throws outright in a private
 *  window on some browsers, and a theme preference is never worth a blank page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_KEY)},s=localStorage.getItem(k);
if(s!=="auto"&&s!=="light"&&s!=="dark")s="auto";
var isDriver=location.pathname.indexOf("/driver")===0;
var prefersLight=matchMedia("(prefers-color-scheme: light)").matches;
var resolved=(isDriver&&s==="auto")?"dark":(s==="light"?"light":(s==="dark"?"dark":(prefersLight?"light":"dark")));
document.documentElement.setAttribute("data-theme",resolved);
document.documentElement.setAttribute("data-skin",resolved);
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute("content",resolved==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)});
}catch(e){}})();`;

/** Writes the choice and tells every mounted consumer in this tab.
 *
 *  localStorage fires no storage event in the tab that wrote it, so without the custom
 *  event a toggle in the header would not reach a second copy of the control in settings.
 */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private-window storage denial -- a theme preference is never worth a blank page.
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/** Applies a resolved light/dark value to the DOM and persists it as an explicit choice
 *  (never "auto") -- what the existing two-state ThemeToggle control calls. A future
 *  three-state control (spec's deferred ThemeToggle3) calls setTheme("auto") directly
 *  instead, which this function deliberately cannot express. */
export function applyResolvedTheme(theme: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-skin", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
  setTheme(theme);
}

/** True on the client, for a route rendered under /driver. Used both by the init script
 *  (inlined above, since it cannot import this module) and by any React consumer that
 *  needs the same driver-route carve-out after hydration. */
export function isDriverRoute(pathname: string): boolean {
  return pathname.startsWith("/driver");
}
