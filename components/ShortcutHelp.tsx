"use client";

import { useEscapeKey } from "@/lib/useEscapeKey";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { helpRows, type Binding } from "@/lib/hotkeys";

/** The map's own shortcuts, now in the REGISTRY's shape.
 *
 *  `routes: ["/map"]` because these belong to the map screen. Nothing about the map's
 *  behaviour changes and no listener is removed — it simply stops being a parallel list that
 *  can drift from what the registry says. `Esc` is here as DOCUMENTATION: the registry never
 *  fires Escape (it belongs to whichever dialog owns focus), but a cheatsheet that omitted it
 *  would be lying about a key that visibly works. */
export const MAP_SHORTCUTS: Binding[] = [
  { keys: "/", description: "جستجوی مشتری، منطقه یا آدرس", routes: ["/map"], order: 10 },
  { keys: "S", description: "باز و بسته کردن پنل کناری", routes: ["/map"], order: 20 },
  { keys: "F", description: "فیلتر بخش‌های پنل", routes: ["/map"], order: 30 },
  { keys: "G", description: "یافتن موقعیت من", routes: ["/map"], order: 40 },
  { keys: "Esc", description: "بستن پنل باز", routes: ["/map"], order: 50 },
  { keys: "?", description: "همین راهنما", routes: ["/map"], order: 60 },
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
export default function ShortcutHelp({
  onClose,
  bindings = MAP_SHORTCUTS,
}: {
  onClose: () => void;
  /** Derived from the registry by default. Overridable so a caller can show a wider set. */
  bindings?: Binding[];
}) {
  const pathname = usePathname() ?? "/";
  useEscapeKey(onClose);

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="میان‌برهای صفحه‌کلید"
      className="modal-enter fixed inset-0 z-[var(--z-help)] flex items-center justify-center bg-black/70 p-4"
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
            <Icon name="x" size="sm" />
          </button>
        </div>

        <dl className="flex flex-col gap-2">
          {helpRows(bindings, pathname).map((s) => (
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
