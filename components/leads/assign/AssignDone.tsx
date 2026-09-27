"use client";

import { useEffect } from "react";
import RunSummary from "@/components/leads/assign/RunSummary";
import { donePhase } from "@/lib/leadRunAssign";

/* How long a finished sheet stays up. Not `OUTBOX_HOLD_MS`: that is how long a *queued*
 * mutation is held back before it is sent, which is a different question. They share a
 * value because tap-flow-principles.md §1 fixes one 5s return window app-wide, not
 * because they are the same thing. */
const DONE_AUTO_CLOSE_MS = 5000;

/** The last screen: whether the hand-over landed, and what to do next.
 *
 *  Three phases, and the distinction matters. `answerStep` flips `saved` synchronously, so
 *  the moment the confirm is tapped this screen is already showing -- while the POST is
 *  still in the air. Claiming success there and taking it back a second later is worse
 *  than saying nothing, so "saving" is a real phase rather than a flicker.
 *
 *  The auto-return is for success only. Yanking a failure away before it has been read is
 *  the one thing a done screen must not do. */
export default function AssignDone({
  message,
  saving,
  driverId,
  driverName,
  driverAvatar,
  runDate,
  stopCount,
  onClose,
  onRetry,
  onRestart,
}: {
  message: { tone: "ok" | "bad"; text: string } | null;
  saving: boolean;
  driverId: number | "";
  driverName: string | null;
  driverAvatar: string | null;
  runDate: string;
  stopCount: number;
  onClose: () => void;
  /** Re-attempts the same hand-over. Distinct from `onRestart`, which starts a different
   *  one -- retrying must not silently throw away the driver and date already chosen. */
  onRetry: () => void;
  onRestart: () => void;
}) {
  const phase = donePhase(message);

  useEffect(() => {
    if (phase !== "ok") return;
    const t = setTimeout(onClose, DONE_AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  if (phase === "saving") {
    return (
      <div className="tf-done">
        <p className="text-text font-medium">در حال ثبت…</p>
        <p className="text-[length:var(--text-xs)] text-text-faint">
          مسیر در حال سپرده شدن به راننده است.
        </p>
      </div>
    );
  }

  if (phase === "bad") {
    return (
      <div className="tf-done">
        <p className="text-crit font-medium">ثبت انجام نشد</p>
        <p className="text-[length:var(--text-xs)] text-text-muted">{message?.text}</p>
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            className="btn solid w-full px-4 py-2"
            disabled={saving}
            onClick={onRetry}
          >
            {saving ? "در حال تلاش…" : "تلاش دوباره"}
          </button>
          <button type="button" className="btn ghost w-full px-4 py-2" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tf-done">
      <p className="text-good font-medium">مسیر سپرده شد</p>
      <div className="w-full">
        <RunSummary
          driverId={driverId === "" ? undefined : driverId}
          driverName={driverName}
          driverAvatar={driverAvatar}
          runDate={runDate}
          stopCount={stopCount}
        />
      </div>
      <p className="text-[length:var(--text-xs)] text-text-muted">{message?.text}</p>
      <p className="text-[length:var(--text-xs)] text-text-faint">۵ ثانیه دیگر بسته می‌شود</p>
      <div className="flex w-full flex-col gap-2">
        <button type="button" className="btn solid w-full px-4 py-2" onClick={onRestart}>
          سپردن مسیر دیگر
        </button>
        <button type="button" className="btn ghost w-full px-4 py-2" onClick={onClose}>
          همین حالا
        </button>
      </div>
    </div>
  );
}
