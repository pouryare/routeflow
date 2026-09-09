"use client";

import { useTheme } from "@/components/ThemeToggle";

/** The artifact's sun/moon toggle: one disc, morphed.
 *
 *  Both glyphs are always in the DOM and cross-fade with a rotation, rather than one
 *  <svg> being swapped for another — a swap reads as a state change, this reads as a
 *  transition. Which one shows is decided entirely in CSS from :root[data-skin], so the
 *  button itself has no idea which icon is visible.
 *
 *  Drives the SAME stored preference as the map's own toggle (lib/theme.ts writes
 *  data-theme and data-skin together), so flipping it here flips the map too.
 */
export default function SkinToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <button
      className="themeToggle"
      type="button"
      aria-label="تغییر پوستهٔ روشن و تاریک"
      aria-pressed={theme === "dark"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <svg className="sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" />
      </svg>
      <svg className="moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" />
      </svg>
    </button>
  );
}
