"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Island, { IslandTone } from "./Island";
import {
  Countdown,
  isElapsed,
  pauseCountdown,
  progressAt,
  quantise,
  resumeCountdown,
  secondsLeft,
  startCountdown,
} from "@/lib/countdown";

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

/** An actionable toast is a deadline, not a notification: once it goes, so does the only
 *  undo. Three and a half seconds is enough to notice a message; it is not enough to read
 *  it, decide the delete was a mistake, and move a thumb across a phone screen.
 *
 *  This is also the value the offline outbox will hold a mutation for before handing it to
 *  the sync engine, so the bar below measures something real rather than counting down for
 *  decoration -- see docs/crm-erp-plan.md 4.6. One constant, so the two cannot drift. */
export const ACTION_LIFETIME_MS = 9000;

// One pill-frame before widening, so the arrival reads as a single motion.
const OPEN_DELAY_MS = 30;
// Long enough for the collapse to finish before the node leaves. --dur-morph plus slack.
const COLLAPSE_MS = 460;
// Bands the bar snaps to under prefers-reduced-motion. Enough to read as draining,
// few enough that nothing appears to move continuously.
const REDUCED_STEPS = 8;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

interface ToastCardProps {
  toast: ToastItem;
  onDone: (id: number) => void;
}

/** One toast, owning its own clock.
 *
 *  The lifetime used to be a `setTimeout` in the provider. It moved in here because a
 *  pausable countdown is per-toast state, and because the same clock now drives two
 *  things that must agree: when the toast leaves, and how full the bar is. Two timers for
 *  one deadline is how a bar ends up empty while the button still works.
 */
function ToastCard({ toast, onDone }: ToastCardProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [srSeconds, setSrSeconds] = useState<number | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const clock = useRef<Countdown | null>(null);
  const reduced = usePrefersReducedMotion();

  const lifetime = toast.action ? ACTION_LIFETIME_MS : LIFETIME_MS[toast.variant];
  // Any one of these holds the clock. Pointer and focus because the reader is engaging
  // with it; hidden because a deadline that expires in a tab nobody is looking at was
  // never offered; running because the action is already under way.
  const paused = hovered || focused || hidden || running;

  const exit = useCallback(() => {
    // Collapse to a pill first, then leave. Vanishing at full width skips the half of
    // the morph that makes the island read as one object rather than a box that blinked.
    setOpen(false);
    window.setTimeout(() => onDone(toast.id), COLLAPSE_MS);
  }, [onDone, toast.id]);

  useEffect(() => {
    clock.current = startCountdown(lifetime, Date.now());
    const id = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [lifetime]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!clock.current) return;
    clock.current = paused
      ? pauseCountdown(clock.current, Date.now())
      : resumeCountdown(clock.current, Date.now());
  }, [paused]);

  // The bar is written straight to the node rather than through state: at 60fps a
  // setState per frame would re-render the message, the buttons and the island's
  // ResizeObserver callback, to move one composited transform.
  useEffect(() => {
    let frame = 0;
    let lastDrawn = -1;
    let done = false;

    const tick = () => {
      const cd = clock.current;
      if (!cd || done) return;
      const now = Date.now();

      const raw = progressAt(cd, now);
      const next = reduced ? quantise(raw, REDUCED_STEPS) : raw;
      if (next !== lastDrawn) {
        lastDrawn = next;
        if (barRef.current) barRef.current.style.transform = `scaleX(${next})`;
      }
      // Only published while paused, so the accessible name is a stable "you have N
      // seconds" rather than a label that renames itself sixty times a second.
      setSrSeconds(cd.startedAt === null ? secondsLeft(cd, now) : null);

      if (isElapsed(cd, now)) {
        done = true;
        exit();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, exit]);

  const runAction = useCallback(async () => {
    if (!toast.action || running) return;
    setRunning(true);
    try {
      await toast.action.onClick();
    } finally {
      // Dismissed either way. A failed undo reports itself with its own error toast;
      // leaving this one up would offer a second attempt at an action whose outcome
      // the user can no longer predict.
      exit();
    }
  }, [toast.action, running, exit]);

  const actionLabel =
    toast.action && srSeconds !== null
      ? `${toast.action.label} — ${srSeconds} ثانیه فرصت`
      : toast.action?.label;

  return (
    <Island
      open={open}
      tone={TONE[toast.variant]}
      icon={ICON[toast.variant]}
      className="pointer-events-auto"
      footer={
        // Only on toasts that carry an action. On a plain message the countdown is not
        // something the reader can act on, so it would be chrome; on this one it is the
        // deadline for the only undo there is.
        toast.action ? (
          <div className="island__timer" aria-hidden="true">
            <div ref={barRef} className="island__timer-fill" />
          </div>
        ) : undefined
      }
    >
      <div
        role="status"
        className="flex items-start gap-2"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
      >
        <span className="block min-w-0 flex-1 leading-5">{toast.message}</span>

        {toast.action && (
          <button
            onClick={runAction}
            disabled={running}
            aria-label={actionLabel}
            className="shrink-0 rounded-[var(--radius-sm)] border border-accent px-2 py-0.5 text-[length:var(--text-xs)] font-medium text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:bg-accent hover:enabled:text-accent-ink disabled:opacity-50"
          >
            {running ? "…" : toast.action.label}
          </button>
        )}

        <button
          onClick={exit}
          aria-label="بستن اعلان"
          className="shrink-0 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
          </svg>
        </button>
      </div>
    </Island>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ShowToast>((message, variant = "info", action) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, variant, action }]);
  }, []);

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
          <ToastCard key={t.id} toast={t} onDone={remove} />
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
