"use client";

import { useEffect } from "react";

export interface Shortcut {
  keys: string;
  description: string;
}

export const MAP_SHORTCUTS: Shortcut[] = [
  { keys: "/", description: "جستجوی مشتری، منطقه یا آدرس" },
  { keys: "S", description: "باز و بسته کردن پنل کناری" },
  { keys: "F", description: "فیلتر بخش‌های پنل" },
  { keys: "G", description: "یافتن موقعیت من" },
  { keys: "Esc", description: "بستن پنل باز" },
  { keys: "؟ / ?", description: "همین راهنما" },
];

/** The shortcut cheatsheet.
 *
 *  Shortcuts that are not written down anywhere are shortcuts nobody has. This is
 *  reachable from "?" -- the key everything else uses for the same purpose -- and from a
 *  line in the sidebar, since guessing that "?" does anything is itself a thing you have
 *  to already know.
 *
 *  Desk-only by nature: none of this exists for the phone in the vehicle, which is why
 *  the sidebar entry sits at the bottom rather than competing with the things a driver
 *  needs.
 */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="میان‌برهای صفحه‌کلید"
      className="modal-enter fixed inset-0 z-[1300] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(28rem,100%)] rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4 elevate-accent"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[length:var(--text-md)] font-bold text-text">میان‌برهای صفحه‌کلید</h2>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="rounded-[var(--radius-sm)] p-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-text"
          >
            ✕
          </button>
        </div>

        <dl className="flex flex-col gap-2">
          {MAP_SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3">
              <dt className="shrink-0">
                <kbd className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 font-mono text-[length:var(--text-xs)] text-accent">
                  {s.keys}
                </kbd>
              </dt>
              <dd className="text-[length:var(--text-sm)] text-text-muted">{s.description}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 border-t border-border pt-3 text-[length:var(--text-xs)] leading-5 text-text-faint">
          میان‌برها وقتی در حال تایپ در یک کادر هستید کار نمی‌کنند.
        </p>
      </div>
    </div>
  );
}
