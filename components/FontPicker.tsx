"use client";

/** The font-family picker: four Persian families, one chosen.
 *
 *  Sibling of AccentPicker in every structural way -- it renders in two shapes from one
 *  component (a compact popover trigger in the مریدین header beside the accent picker, and
 *  the same popover as a floating square control on the map), the dismiss/keyboard
 *  behaviour is shared, and the choice is persisted per browser and broadcast to every
 *  mounted copy.
 *
 *  Each option previews its own label in its own typeface, so the choice is legible
 *  before it is applied. The family behind each id lives in app/fonts.ts and is wired to
 *  `--font-ui` by app/globals.css under `:root[data-font="<id>"]`.
 */

import { useEffect, useRef, useState } from "react";
import {
  FONT_CHANGE_EVENT,
  applyFont,
  readFont,
  type FontId,
} from "@/lib/font";
import { FONT_CHOICES, DEFAULT_FONT } from "@/lib/fontChoices";

/** Reads the chosen font and keeps every mounted copy of the picker in step.
 *
 *  Starts at the default rather than at the stored value: the server rendered the
 *  default, and disagreeing with it here is a hydration mismatch. The real value arrives
 *  one frame later, by which point the inline init script has already applied the right
 *  family -- so nothing visible is waiting on this. Same shape as useAccent / useTheme. */
export function useFont(): [FontId, (f: FontId) => void] {
  const [font, setFont] = useState<FontId>(DEFAULT_FONT);

  useEffect(() => {
    const read = () => setFont(readFont());
    read();
    window.addEventListener(FONT_CHANGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(FONT_CHANGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return [font, applyFont];
}

export default function FontPicker({
  variant = "header",
  className = "",
}: {
  /** "header" sits inline in the مریدین top bar; "map" is a floating square control
   *  matching the map's other right-edge buttons. */
  variant?: "header" | "map";
  className?: string;
}) {
  const [font, setFont] = useFont();
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

  const current = FONT_CHOICES.find((f) => f.id === font) ?? FONT_CHOICES[0];

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
        aria-label={`قلم برنامه — اکنون ${current.label}`}
        title={`قلم: ${current.label}`}
        className={trigger}
      >
        {/* The glyph is set in the LIVE ui font, so the trigger already shows the choice. */}
        <span
          aria-hidden="true"
          className="text-[15px] leading-none text-text"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          آ
        </span>
      </button>

      {open && (
        <div
          dir="rtl"
          role="dialog"
          aria-label="انتخاب قلم"
          /* Same edge maths as AccentPicker: the map trigger is pinned to the physical
             right edge so its popover hangs leftward (`right-0`); the header trigger sits
             at the visual left in this RTL bar so its popover opens rightward (`end-0`). */
          className={`absolute z-[var(--z-panel)] w-[15rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius-lg)] border border-border bg-surface-raised p-2.5 shadow-[var(--elev-2)] ${
            variant === "map" ? "right-0 top-12" : "end-0 top-11"
          }`}
        >
          <p className="mb-2 px-1 font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-text-faint">
            قلم
          </p>
          <div className="opt-row half gap-1.5">
            {FONT_CHOICES.map((f) => {
              const on = f.id === font;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFont(f.id)}
                  aria-pressed={on}
                  title={f.label}
                  className={`group flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-2 transition-[border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] active:scale-[0.97] ${
                    on ? "border-accent bg-accent-soft" : "border-border hover:border-accent"
                  }`}
                >
                  {/* «آ ب پ» in the option's own face -- three joined-then-not shapes read
                      the family at a glance without needing a full sentence. */}
                  <span
                    aria-hidden="true"
                    className="text-[22px] leading-none text-text"
                    style={{ fontFamily: `var(${f.var})` }}
                  >
                    آ ب پ
                  </span>
                  <span
                    className="text-[length:var(--text-xs)] leading-4 text-text-muted group-aria-pressed:text-text"
                    style={{ fontFamily: `var(${f.var})` }}
                  >
                    {f.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[length:var(--text-xs)] leading-5 text-text-faint">
            عنوان‌های درشت با قلم «داماوند» می‌مانند و تغییر نمی‌کنند.
          </p>
        </div>
      )}
    </div>
  );
}
