"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Island, { IslandTone } from "./Island";

type ToastVariant = "success" | "error" | "info";

/** A single button rendered inside the toast.
 *
 *  Two things use this, and they are the same mechanism seen from opposite ends:
 *  an undo, which reverses what just happened, and a follow-up, which takes you to it.
 *  Either way the toast becomes the only place that action is offered, so it has to
 *  survive long enough to be read and hit -- see ACTION_LIFETIME_MS. */
export interface ToastAction {
  label: string;
  /** Awaited so the toast can show a working state instead of vanishing mid-request. */
  onClick: () => void | Promise<void>;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  running: boolean;
  open: boolean;
}

type ShowToast = (message: string, variant?: ToastVariant, action?: ToastAction) => void;
const ToastContext = createContext<ShowToast | null>(null);

const TONE: Record<ToastVariant, IslandTone> = {
  success: "good",
  error: "crit",
  info: "accent",
};

/** Drawn rather than typed. The glyphs these replace (✓ ⚠ ℹ) rendered in whatever the
 *  system had for them, which on Android meant a different weight and baseline per device
 *  and, in a Persian layout, occasional mirroring. */
const ICON: Record<ToastVariant, React.ReactNode> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.2 3.2L13 5" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.6l5.8 10.1H2.2L8 2.6z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.4h.01" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4v3.2" />
      <path d="M8 5.2h.01" />
    </svg>
  ),
};

const LIFETIME_MS: Record<ToastVariant, number> = { success: 3500, error: 6500, info: 4000 };

// An actionable toast is a deadline, not a notification: once it goes, so does the only
// undo. Three and a half seconds is enough to notice a message; it is not enough to read
// it, decide the delete was a mistake, and move a thumb across a phone screen.
const ACTION_LIFETIME_MS = 9000;

// One pill-frame before widening, so the arrival reads as a single motion.
const OPEN_DELAY_MS = 30;
// Long enough for the collapse to finish before the node leaves. --dur-morph plus slack.
const COLLAPSE_MS = 460;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<number[]>([]);

  // Every timer this provider opens, cancelled on unmount. Without it a toast scheduled
  // just before a route change calls setState on a component that is gone.
  useEffect(() => {
    const owned = timers.current;
    return () => owned.forEach(window.clearTimeout);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startExit = useCallback(
    (id: number) => {
      // Collapse to a pill first, then leave. Vanishing at full width skips the half of
      // the morph that makes the island read as one object rather than a box that blinked.
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)));
      later(() => remove(id), COLLAPSE_MS);
    },
    [later, remove]
  );

  const showToast = useCallback<ShowToast>(
    (message, variant = "info", action) => {
      const id = ++idRef.current;
      setToasts((prev) => [
        ...prev,
        { id, message, variant, action, running: false, open: false },
      ]);
      later(
        () => setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, open: true } : t))),
        OPEN_DELAY_MS
      );
      later(() => startExit(id), action ? ACTION_LIFETIME_MS : LIFETIME_MS[variant]);
    },
    [later, startExit]
  );

  const runAction = useCallback(
    async (t: ToastItem) => {
      if (!t.action || t.running) return;
      setToasts((prev) => prev.map((x) => (x.id === t.id ? { ...x, running: true } : x)));
      try {
        await t.action.onClick();
      } finally {
        // Dismissed either way. A failed undo reports itself with its own error toast;
        // leaving this one up would offer a second attempt at an action whose outcome
        // the user can no longer predict.
        startExit(t.id);
      }
    },
    [startExit]
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* Centred rather than corner-pinned: the island idiom reads as coming from the top
          of the device, and centring is the one position that is identical in RTL and LTR
          so the layout does not have to be checked twice. */}
      <div
        dir="rtl"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed left-1/2 top-4 z-[var(--z-toast)] flex -translate-x-1/2 flex-col items-center gap-2"
      >
        {toasts.map((t) => (
          <Island
            key={t.id}
            open={t.open}
            tone={TONE[t.variant]}
            icon={ICON[t.variant]}
            className="pointer-events-auto"
          >
            <div role="status" className="flex items-start gap-2">
              <span className="block min-w-0 flex-1 leading-5">{t.message}</span>

              {t.action && (
                <button
                  onClick={() => runAction(t)}
                  disabled={t.running}
                  className="shrink-0 rounded-[var(--radius-sm)] border border-accent px-2 py-0.5 text-[length:var(--text-xs)] font-medium text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:bg-accent hover:enabled:text-accent-ink disabled:opacity-50"
                >
                  {t.running ? "…" : t.action.label}
                </button>
              )}

              <button
                onClick={() => startExit(t.id)}
                aria-label="بستن اعلان"
                className="shrink-0 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                </svg>
              </button>
            </div>
          </Island>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Safe to call even before the provider mounts (e.g. during a fast refresh edge case) --
// falls back to a no-op instead of throwing, since a missed toast is far less harmful
// than a crashed page.
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  return ctx ?? (() => {});
}
