"use client";

/** The accent colour picker: ten swatches, one chosen.
 *
 *  Renders in two shapes from one component, because it lives in two places that want
 *  different things -- a compact popover trigger in the کارگاه header beside the sun/moon
 *  toggle, and the same popover hung under the theme button on the map. Rather than two
 *  components drifting apart, the shape is a prop and the behaviour is shared.
 *
 *  Every colour comes from CSS. This file knows ids and labels; the hex values in
 *  ACCENT_THEMES exist only so a swatch can be drawn before the theme is applied, and
 *  both that list and the stylesheet are written by the same generator run.
 */

import { useEffect, useRef, useState } from "react";
import {
  ACCENT_CHANGE_EVENT,
  applyAccent,
  readAccent,
  type AccentId,
} from "@/lib/accent";
import { ACCENT_THEMES, DEFAULT_ACCENT } from "@/lib/accentThemes";
import { useTheme } from "@/components/ThemeToggle";

/** Reads the chosen accent and keeps every mounted copy of the picker in step.
 *
 *  Starts at the default rather than at the stored value: the server rendered the
 *  default, and disagreeing with it here is a hydration mismatch. The real value arrives
 *  one frame later, by which point the inline init script has already painted the right
 *  colours -- so nothing visible is waiting on this. Same shape as useTheme. */
export function useAccent(): [AccentId, (a: AccentId) => void] {
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);

  useEffect(() => {
    const read = () => setAccent(readAccent());
    read();
    window.addEventListener(ACCENT_CHANGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(ACCENT_CHANGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return [accent, applyAccent];
}

export default function AccentPicker({
  variant = "header",
  className = "",
}: {
  /** "header" sits inline in the کارگاه top bar; "map" is a floating square control
   *  matching the map's other right-edge buttons. */
  variant?: "header" | "map";
  className?: string;
}) {
  const [accent, setAccent] = useAccent();
  const [theme] = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A popover that cannot be dismissed by looking away is a popover that is in the way.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = ACCENT_THEMES.find((t) => t.id === accent) ?? ACCENT_THEMES[0];

  const trigger =
    variant === "map"
      ? "flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-raised elevate-accent transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:border-accent active:scale-[0.98]"
      : "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent active:scale-[0.98]";

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`رنگ ظاهر برنامه — اکنون ${current.label}`}
        title={`رنگ ظاهر: ${current.label}`}
        className={trigger}
      >
        {/* The swatch IS the icon: a colour picker whose trigger does not show the colour
            makes you open it to find out what you chose. */}
        <span
          aria-hidden="true"
          className="block h-4 w-4 rounded-full border border-black/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,.28)]"
          style={{ background: "var(--accent)" }}
        />
      </button>

      {open && (
        <div
          dir="rtl"
          role="dialog"
          aria-label="انتخاب رنگ ظاهر"
          className={`absolute z-[var(--z-panel)] w-[16.5rem] rounded-[var(--radius-lg)] border border-border bg-surface-raised p-2.5 shadow-[var(--elev-2)] ${
            variant === "map" ? "left-0 top-12" : "end-0 top-11"
          }`}
        >
          <p className="mb-2 px-1 font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-text-faint">
            رنگ ظاهر
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {ACCENT_THEMES.map((t) => {
              const on = t.id === accent;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAccent(t.id)}
                  aria-pressed={on}
                  title={t.label}
                  className={`group flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border px-1 py-1.5 transition-[border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] active:scale-[0.95] ${
                    on ? "border-accent" : "border-transparent hover:border-border"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`block h-6 w-6 rounded-full border border-black/15 ${
                      on ? "ring-2 ring-accent ring-offset-1 ring-offset-[color:var(--surface-raised)]" : ""
                    }`}
                    /* The swatch has to show its OWN colour, not the active theme's, so it
                       cannot use var(--accent) -- hence the generated hex, picked per
                       skin because a light-mode accent is not the dark-mode one. */
                    style={{ background: t.swatch[theme] }}
                  />
                  <span className="truncate text-[length:var(--text-xs)] leading-4 text-text-muted group-aria-pressed:text-text">
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[length:var(--text-xs)] leading-5 text-text-faint">
            رنگ‌های وضعیت (سبز، کهربایی، قرمز) تغییر نمی‌کنند — معنایشان همه‌جا یکی است.
          </p>
        </div>
      )}
    </div>
  );
}
