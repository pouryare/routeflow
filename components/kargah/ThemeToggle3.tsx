"use client";

import { useEffect, useState } from "react";
import { THEME_CHANGE_EVENT, readTheme, setTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "auto", label: "خودکار" },
  { value: "dark", label: "تاریک" },
];

/** The rail's foot control (spec 2026-09-08 §9a decision 3): auto/light/dark, all three
 *  reachable. Unlike ThemeToggle (always resolves "auto" to a concrete value for
 *  display), this reads and writes the RAW stored preference -- "auto" is a real,
 *  visible, selectable state here, not merely an implicit default. */
export default function ThemeToggle3({ className }: { className?: string }) {
  const [value, setValue] = useState<Theme>("auto");

  useEffect(() => {
    const read = () => setValue(readTheme());
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return (
    <div className={className} role="radiogroup" aria-label="حالت نمایش" data-theme3>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          title={opt.label}
          className="theme3__opt"
          data-active={value === opt.value ? "true" : undefined}
          onClick={() => setTheme(opt.value)}
        >
          <span className="sr-only">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
