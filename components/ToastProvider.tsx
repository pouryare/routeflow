"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

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
  leaving: boolean;
}

type ShowToast = (message: string, variant?: ToastVariant, action?: ToastAction) => void;
const ToastContext = createContext<ShowToast | null>(null);

const VARIANT_META: Record<ToastVariant, { border: string; icon: string; elevate: string }> = {
  success: { border: "border-good", icon: "✓", elevate: "elevate-good" },
  error: { border: "border-crit", icon: "⚠", elevate: "elevate-crit" },
  info: { border: "border-accent", icon: "ℹ", elevate: "elevate-accent" },
};

const LIFETIME_MS: Record<ToastVariant, number> = { success: 3500, error: 6500, info: 4000 };

// An actionable toast is a deadline, not a notification: once it goes, so does the only
// undo. Three and a half seconds is enough to notice a message; it is not enough to read
// it, decide the delete was a mistake, and move a thumb across a phone screen.
const ACTION_LIFETIME_MS = 9000;

const EXIT_MS = 180;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startExit = useCallback(
    (id: number) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      window.setTimeout(() => remove(id), EXIT_MS);
    },
    [remove]
  );

  const showToast = useCallback<ShowToast>(
    (message, variant = "info", action) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant, action, running: false, leaving: false }]);
      window.setTimeout(() => startExit(id), action ? ACTION_LIFETIME_MS : LIFETIME_MS[variant]);
    },
    [startExit]
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
      <div
        dir="rtl"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed left-4 top-4 z-[2000] flex w-[calc(100%-2rem)] max-w-xs flex-col gap-2"
      >
        {toasts.map((t) => {
          const meta = VARIANT_META[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2 rounded-[var(--radius-md)] border ${meta.border} bg-surface-raised px-3 py-2 text-[length:var(--text-sm)] text-text ${meta.elevate} ${
                t.leaving ? "toast-exit" : "toast-enter"
              }`}
            >
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block leading-5">{t.message}</span>
                {t.action && (
                  <button
                    onClick={() => runAction(t)}
                    disabled={t.running}
                    className="mt-1.5 rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:bg-accent hover:enabled:text-[#04191c] disabled:opacity-50"
                  >
                    {t.running ? "…" : t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => startExit(t.id)}
                aria-label="بستن اعلان"
                className="shrink-0 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
              >
                ✕
              </button>
            </div>
          );
        })}
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
