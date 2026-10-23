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

import { Button, Popover } from "@heroui/react";
import { useEffect, useState } from "react";
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

  const current = FONT_CHOICES.find((f) => f.id === font) ?? FONT_CHOICES[0];

  const trigger =
    variant === "map"
      ? "flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-raised elevate-accent transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:border-accent active:scale-[0.98]"
      : "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent active:scale-[0.98]";

  return (
    <div className={className}>
      <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        isIconOnly
        variant="ghost"
        aria-label={`قلم برنامه — اکنون ${current.label}`}
        className={trigger}
      >
        {/* No document glyph. «آ» below is set in the LIVE ui font, so the trigger is already a
            picture of the current choice — the file icon beside it said only "this opens
            something", in a second glyph, inside a 36px circle that had room for one. */}
        {/* The glyph is set in the LIVE ui font, so the trigger already shows the choice. */}
        <span
          aria-hidden="true"
          className="text-[15px] leading-none text-text"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          آ
        </span>
      </Button>

        <Popover.Content placement="bottom end" offset={6} className="picker-pop">
        <Popover.Dialog
          dir="rtl"
          aria-label="انتخاب قلم"
          className="w-[15rem] max-w-[calc(100vw-2rem)] p-2.5"
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
                  {/* No tick on the selected option. It already carries three signals of its own —
                      `border-accent bg-accent-soft`, the bolder label under
                      `group-aria-pressed`, and `aria-pressed` itself — so the glyph was a
                      fourth way of saying the same thing, in the one slot that made the row
                      taller than its neighbours. */}
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
        </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
