"use client";

import { useId, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  THEME_CHANGE_EVENT,
  Theme,
  applyTheme,
  readTheme,
  switchTheme,
} from "@/lib/theme";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reads the chosen theme and keeps every mounted copy of the control in step.
 *
 *  A store read: the server (and the hydrating render) says DEFAULT_THEME, the browser
 *  answers from localStorage on the next render, and a client-only render -- the map is
 *  one -- gets the real skin on its first. The custom event carries same-tab changes
 *  and the storage event carries other tabs, since localStorage fires no event in the
 *  tab that wrote it.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  return [useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME), applyTheme];
}

/** Sun ⇄ moon, as a morph rather than an icon swap.
 *
 *  One disc the whole time. Going dark, the rays retract into it and a bite -- a second
 *  circle punched out of the mask -- slides across to crescent it. Swapping one <svg> for
 *  another would be cheaper and would read as a state change rather than as a transition;
 *  this is a Tier 1 direct-manipulation control in MASTER.md's terms, so it springs.
 *
 *  Everything animates from CSS keyed on :root[data-theme], never from this component's
 *  state, so the icon is already in the right shape on the very first paint -- before
 *  React has hydrated and before useTheme has read anything.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme] = useTheme();
  const maskId = useId();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={(e) => switchTheme(next, e.currentTarget)}
      aria-pressed={theme === "light"}
      // The icon shows the mode you are in; only the label says what pressing does. An
      // icon alone is genuinely ambiguous here -- a moon can as easily mean "you are in
      // dark mode" as "press for dark mode" -- and both readings are common in the wild.
      aria-label={next === "light" ? "تغییر به حالت روشن" : "تغییر به حالت تیره"}
      title={next === "light" ? "تغییر به حالت روشن" : "تغییر به حالت تیره"}
      className={`theme-toggle ${className}`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <mask id={maskId}>
          <rect x="0" y="0" width="24" height="24" fill="black" />
          <circle cx="12" cy="12" r="6" fill="white" />
          {/* Punched out of the disc. Parked outside the glyph in light mode, slid over
              it in dark -- that overlap is the crescent. */}
          <circle className="theme-toggle__bite" cx="12" cy="12" r="6" fill="black" />
        </mask>

        <g
          className="theme-toggle__rays"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <line x1="20.5" y1="12" x2="22.5" y2="12" />
          <line x1="18.01" y1="18.01" x2="19.42" y2="19.42" />
          <line x1="12" y1="20.5" x2="12" y2="22.5" />
          <line x1="5.99" y1="18.01" x2="4.58" y2="19.42" />
          <line x1="3.5" y1="12" x2="1.5" y2="12" />
          <line x1="5.99" y1="5.99" x2="4.58" y2="4.58" />
          <line x1="12" y1="3.5" x2="12" y2="1.5" />
          <line x1="18.01" y1="5.99" x2="19.42" y2="4.58" />
        </g>

        <circle
          className="theme-toggle__disc"
          cx="12"
          cy="12"
          r="6"
          fill="currentColor"
          mask={`url(#${maskId})`}
        />
      </svg>
    </button>
  );
}
