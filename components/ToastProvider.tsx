"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

type ShowToast = (message: string, variant?: ToastVariant) => void;
const ToastContext = createContext<ShowToast | null>(null);

const VARIANT_META: Record<ToastVariant, { border: string; icon: string; elevate: string }> = {
  success: { border: "border-good", icon: "✓", elevate: "elevate-good" },
  error: { border: "border-crit", icon: "⚠", elevate: "elevate-crit" },
  info: { border: "border-accent", icon: "ℹ", elevate: "elevate-accent" },
};

const LIFETIME_MS: Record<ToastVariant, number> = { success: 3500, error: 6500, info: 4000 };
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
    (message, variant = "info") => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant, leaving: false }]);
      window.setTimeout(() => startExit(id), LIFETIME_MS[variant]);
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
              <span className="min-w-0 flex-1 leading-5">{t.message}</span>
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
