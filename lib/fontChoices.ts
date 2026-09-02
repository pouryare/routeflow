/** The font picker's catalogue: four families the reader can choose between.
 *
 *  Same shape as lib/accentThemes.ts -- this is only what the picker needs to draw a
 *  labelled option and preview it in its own face. The `var` here is the CSS custom
 *  property that app/globals.css maps `--font-ui` to under `:root[data-font="<id>"]`;
 *  the picker previews each label with `font-family: var(<var>)`.
 *
 *  Peyda is the default and the identity. Damavand (display) is not in this list -- it
 *  stays the display voice for every choice.
 */
export const FONT_CHOICES = [
  { id: "peyda", label: "پیدا", var: "--font-ui" },
  { id: "yekan", label: "ایران‌یکان", var: "--font-yekan" },
  { id: "sans", label: "ایران‌سنس", var: "--font-sansx" },
  { id: "iran", label: "ایران", var: "--font-iran" },
] as const;

export type FontId = (typeof FONT_CHOICES)[number]["id"];

/** What a browser that has never chosen gets, and what the server renders. */
export const DEFAULT_FONT: FontId = "peyda";

export function isFontId(v: unknown): v is FontId {
  return typeof v === "string" && FONT_CHOICES.some((f) => f.id === v);
}
