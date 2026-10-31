"use client";

import { createContext, useCallback, useContext, useEffect } from "react";
import { Toast, toast } from "@heroui/react";
import { Icon, type IconName } from "@/components/meridian/Icon";
import { OUTBOX_HOLD_MS } from "@/lib/offline/constants";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";

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
  /** The button's glyph. Defaults to a check, which is right for "go there" and wrong for
   *  "undo this" — a tick on a button that reverses something reads as confirming it. */
  icon?: IconName;
}

type ShowToast = (message: string, variant?: ToastVariant, action?: ToastAction) => void;
const ToastContext = createContext<ShowToast | null>(null);

/** Named, never typed: a named Lucide icon is one drawing on every platform, where the
 *  text glyphs this once used rendered per device and sometimes mirrored in RTL. */
const ICON: Record<ToastVariant, IconName> = {
  success: "check",
  error: "warn",
  info: "info",
};

/** The sound each toast makes (lib/sound.ts). A save that also flashes its check mark makes one
 *  sound, not two: lib/sound.ts drops the second of two sounds that close together. */
const SOUND = { success: "action.done", error: "action.failed", info: "toast.shown" } as const;

/** HeroUI's variant for each of ours. */
const HERO_VARIANT = { success: "success", error: "danger", info: "accent" } as const;

const LIFETIME_MS: Record<ToastVariant, number> = { success: 3500, error: 6500, info: 4000 };

/** An actionable toast is a deadline, not a notification: once it goes, so does the only
 *  undo. Three and a half seconds is enough to notice a message; it is not enough to read
 *  it, decide the delete was a mistake, and move a thumb across a phone screen.
 *
 *  This is also the value the offline outbox holds a mutation for before handing it to
 *  the sync engine -- see docs/crm-erp-plan.md 4.6. One constant (lib/offline/constants.ts),
 *  so the toast and the hold cannot drift. */
export const ACTION_LIFETIME_MS = OUTBOX_HOLD_MS;

/** Toasts are HeroUI's (docs/roadmap.md §10): `toast()` adds to one queue and
 *  `<Toast.Provider>` draws it. React Aria already pauses the clock while the region is
 *  hovered or focused; this adds the third pause the hand-built toast had -- a deadline
 *  that runs out in a tab nobody is looking at was never offered.
 *
 *  `useToast()` keeps its old signature, so none of its callers changed. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onVisibility = () => (document.visibilityState === "hidden" ? toast.pauseAll() : toast.resumeAll());
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const showToast = useCallback<ShowToast>((message, variant = "info", action) => {
    if (variant !== "info") haptic(variant);
    const base = {
      variant: HERO_VARIANT[variant],
      indicator: <Icon name={ICON[variant]} size="md" />,
      timeout: action ? ACTION_LIFETIME_MS : LIFETIME_MS[variant],
    };
    playSound(SOUND[variant]);
    if (!action) {
      toast(message, base);
      return;
    }
    const label = (
      <>
        <Icon name={action.icon ?? "check"} size="sm" />
        {action.label}
      </>
    );
    const id = toast(message, {
      ...base,
      actionProps: {
        children: label,
        variant: "secondary",
        onPress: async () => {
          // Held open while the action runs, then dismissed either way. A failed undo reports
          // itself with its own error toast; leaving this one up would offer a second attempt
          // at an action whose outcome the user can no longer predict.
          toast.update(id, message, { ...base, timeout: 0, actionProps: { children: label, variant: "secondary", isPending: true } });
          try {
            await action.onClick();
          } finally {
            toast.close(id);
          }
        },
      },
    });
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* At the top, centred: identical in RTL and LTR, and clear of the bottom bar and the
          thumb zone the flows use. */}
      <Toast.Provider placement="top" maxVisibleToasts={3} className="app-toasts" />
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
