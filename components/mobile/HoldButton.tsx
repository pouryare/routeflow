"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ProgressCircle } from "@heroui/react";
import { HOLD_MS, holdProgress, startsHold } from "@/lib/holdPress";

/** Confirm-by-holding for the actions that cannot be undone: the ring fills while the finger stays
 *  down and the action runs when it is full; letting go early cancels. Space or Enter held on the
 *  focused button works the same. Not for ordinary taps: those use the undo bar instead. */
export default function HoldButton({
  children,
  onConfirm,
  disabled,
  holdMs = HOLD_MS,
}: {
  children: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  holdMs?: number;
}) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const frame = useRef(0);

  const stop = useCallback(() => {
    start.current = null;
    cancelAnimationFrame(frame.current);
    setProgress(0);
  }, []);

  const begin = useCallback(() => {
    if (disabled || start.current !== null) return;
    start.current = performance.now();
    const tick = () => {
      if (start.current === null) return;
      const p = holdProgress(performance.now() - start.current, holdMs);
      setProgress(p);
      if (p >= 1) {
        start.current = null;
        onConfirm();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [disabled, holdMs, onConfirm]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={typeof children === "string" ? `${children} (نگه دارید)` : undefined}
      className="touch relative inline-flex min-h-[52px] w-full select-none items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--crit)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-[var(--crit)] disabled:opacity-50"
      style={{ touchAction: "none" }}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (startsHold(e.key, e.repeat)) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onBlur={stop}
    >
      {/* no Icon: the progress ring is this button's icon */}
      <ProgressCircle aria-label="پیشرفت نگه داشتن" value={progress * 100} size="sm" color="danger">
        <ProgressCircle.Track>
          <ProgressCircle.TrackCircle />
          <ProgressCircle.FillCircle />
        </ProgressCircle.Track>
      </ProgressCircle>
      <span>{children}</span>
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">نگه دارید</span>
    </button>
  );
}
