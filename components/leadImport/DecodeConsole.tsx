"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ProgressBar from "./ProgressBar";
import LiveItemList, { type LiveItem } from "./LiveItemList";
import ProblemList from "./ProblemList";
import { faNum } from "@/lib/format";
import { formatEta } from "@/lib/leadImport/eta";
import { EASE, DUR, withReducedMotion } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

/** How long the undo stays offered. Long enough to notice and reach for, short enough
 *  that it is not a permanent fixture on a panel nobody is reading. */
const UNDO_WINDOW_MS = 10_000;

/** The words under the bar, naming the method and how many links still need it.
 *
 *  This is the sentence that answers "why is this slow" without the user having to ask.
 *  It deliberately names the most expensive thing still outstanding rather than an
 *  average -- if a hundred links are waiting on Chromium, saying so is the point. */
function methodSentence(
  currentMethod: string | null,
  remaining: Record<string, number>
): string {
  if (!currentMethod) return "در حال پایان…";
  const name =
    currentMethod === "browser"
      ? "مرورگر باز می‌کند"
      : currentMethod === "nominatim"
        ? "نشانی‌یابی"
        : "خواندن لینک‌ها";
  const count = remaining[currentMethod] ?? 0;
  return count > 0 ? `${name} (${faNum(count)} مورد)` : name;
}

export interface JobSnapshot {
  id: number;
  status: "running" | "done" | "cancelled";
  total: number;
  done_count: number;
  unresolved_count: number;
  duplicate_count: number;
  added_count: number;
}

export default function DecodeConsole({
  snapshot,
  items,
  currentMethod,
  remaining,
  etaSeconds,
  onCancel,
  onUndo,
  onDismiss,
}: {
  snapshot: JobSnapshot;
  items: LiveItem[];
  currentMethod: string | null;
  remaining: Record<string, number>;
  etaSeconds: number;
  onCancel: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const running = snapshot.status === "running";
  const finished = !running;

  const [undoLeft, setUndoLeft] = useState(UNDO_WINDOW_MS);
  useEffect(() => {
    if (!finished) return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = UNDO_WINDOW_MS - (Date.now() - started);
      setUndoLeft(left);
      if (left <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [finished]);

  const settled = items.filter(
    (i) => i.status !== "pending" && i.status !== "resolving"
  ).length;
  const problems = items.filter(
    (i) => i.status === "unresolved" || i.status === "duplicate"
  );

  return (
    <div>
      <ProgressBar
        done={settled}
        total={snapshot.total}
        label={running ? methodSentence(currentMethod, remaining) : undefined}
      />

      {running && (
        <p className="mt-1 flex items-center justify-between text-[length:var(--text-xs)] text-text-faint">
          <span>{formatEta(etaSeconds)}</span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors duration-[var(--dur-base)] hover:text-text"
          >
            توقف
          </button>
        </p>
      )}

      {/* The list collapses rather than disappearing: a finished run's worth of rows is
          noise once the numbers are on screen, and a hard cut reads as a glitch. */}
      <AnimatePresence initial={false}>
        {!finished && (
          <motion.div
            key="live"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={withReducedMotion(
              { duration: DUR.morph, ease: EASE.out },
              reduced
            )}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <LiveItemList items={items} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {finished && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[length:var(--text-sm)]">
          <span className="text-[color:var(--good)]">
            <IconCheck /> {faNum(snapshot.added_count)} مکان اضافه شد
          </span>
          {snapshot.unresolved_count > 0 && (
            <span className="text-[color:var(--warn)]">
              {faNum(snapshot.unresolved_count)} نیاز به بررسی دارد
            </span>
          )}
          {undoLeft > 0 && (
            <button
              type="button"
              onClick={onUndo}
              className="rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] hover:border-accent hover:text-accent"
            >
              بازگرداندن
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="mr-auto text-[length:var(--text-xs)] text-text-faint hover:text-text"
          >
            بستن
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <ProblemList items={problems} />
        </div>
      )}
    </div>
  );
}

function IconCheck() {
  return <span aria-hidden="true">✓</span>;
}
