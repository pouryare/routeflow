/** Self-hosted font faces for the whole app.
 *
 *  `next/font/local` must be called at module scope, so every family lives here and is
 *  consumed as a CSS variable from app/layout.tsx. Nothing here decides which family is
 *  *active* -- that is `data-font` on <html> plus the `:root[data-font=...]` remap in
 *  app/globals.css. See lib/font.ts.
 *
 *  Roles:
 *    ui       -- body, labels, headings          (Peyda, switchable)
 *    uiNum    -- figures / amounts, tabular       (Peyda FaNum, switchable)
 *    display  -- the big display face             (Damavand, NOT switchable)
 *    yekan / sansx / iran (+ *Num) -- the other three picker choices
 *
 *  `preload: false` on every face: next/font would otherwise <link rel=preload> all 25 files on every
 *  page (1.1 MB, ahead of the scripts on a slow line). A @font-face is only fetched when text uses
 *  it, so each screen now downloads just the weights it draws, and the picker faces only when picked.
 *
 *  The picker only swaps the body + number family; Damavand stays the display voice for
 *  every choice. Peyda and Damavand ship as vendor web woff2; IRANYekanX / IRANSansX have
 *  no woff2 UI face in their kits, so their Regular is the .ttf (FaNum digits still woff2).
 */
import localFont from "next/font/local";

/* ---- Peyda: the default UI voice, full weight ladder ---------------------- */
export const ui = localFont({
  variable: "--font-ui",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "../public/fonts/PeydaWeb-Thin.woff2", weight: "100", style: "normal" },
    { path: "../public/fonts/PeydaWeb-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "../public/fonts/PeydaWeb-Light.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/PeydaWeb-Regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/PeydaWeb-Medium.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/PeydaWeb-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/PeydaWeb-Bold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/PeydaWeb-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "../public/fonts/PeydaWeb-Black.woff2", weight: "900", style: "normal" },
    { path: "../public/fonts/PeydaWeb-ExtraBlack.woff2", weight: "950", style: "normal" },
  ],
});

export const uiNum = localFont({
  variable: "--font-num",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "../public/fonts/PeydaFaNumWeb-Regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/PeydaFaNumWeb-Medium.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/PeydaFaNumWeb-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/PeydaFaNumWeb-Bold.woff2", weight: "700", style: "normal" },
  ],
});

/* ---- Damavand: display only, one weight --------------------------------- */
export const display = localFont({
  variable: "--font-damavand",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [{ path: "../public/fonts/Damavand-ExtraBold.woff2", weight: "800", style: "normal" }],
});

/* ---- IRANYekanX (picker choice "yekan") -------------------------------- */
export const yekan = localFont({
  variable: "--font-yekan",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [{ path: "../public/fonts/IRANYekanX-Regular.ttf", weight: "400", style: "normal" }],
});

export const yekanNum = localFont({
  variable: "--font-yekan-num",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "../public/fonts/IRANYekanXFaNum-Regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/IRANYekanXFaNum-Bold.woff2", weight: "700", style: "normal" },
  ],
});

/* ---- IRANSansX (picker choice "sans") -------------------------------- */
export const sansx = localFont({
  variable: "--font-sansx",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [{ path: "../public/fonts/IRANSansX-Regular.ttf", weight: "400", style: "normal" }],
});

export const sansxNum = localFont({
  variable: "--font-sansx-num",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "../public/fonts/IRANSansXFaNum-Regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/IRANSansXFaNum-Bold.woff2", weight: "700", style: "normal" },
  ],
});

/* ---- IRAN Family (picker choice "iran") ------------------------------ */
export const iran = localFont({
  variable: "--font-iran",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "../public/fonts/IRAN.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/IRANBold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/IRANBlack.woff2", weight: "900", style: "normal" },
  ],
});

export const iranNum = localFont({
  variable: "--font-iran-num",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  src: [{ path: "../public/fonts/IRAN-FaNum.woff", weight: "400", style: "normal" }],
});

/** Every face's `.variable` class, for the <html> className. */
export const ALL_FONT_VARS = [
  ui,
  uiNum,
  display,
  yekan,
  yekanNum,
  sansx,
  sansxNum,
  iran,
  iranNum,
]
  .map((f) => f.variable)
  .join(" ");
