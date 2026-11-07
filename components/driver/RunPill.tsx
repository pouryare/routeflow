"use client";

import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { RunPillModel } from "@/lib/runPill";

/** The live run in one pill that stays at the top while the list scrolls: «توقف ۴ از ۱۲» and who is next.
 *  Tapping it opens that stop's delivery flow. A thin bar under the words fills as stops are finished. */
export default function RunPill({ pill, onOpen }: { pill: RunPillModel; onOpen: (stopId: number) => void }) {
  const pct = pill.total > 0 ? Math.round((pill.doneCount / pill.total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(pill.nextId)}
      className="runpill touch sticky top-[var(--space-2)] z-10 flex min-h-[48px] w-full items-center gap-[var(--space-3)] rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] text-right shadow-md"
      aria-label={`توقف ${faNum(pill.index)} از ${faNum(pill.total)}، ${pill.name}؛ باز کردن ثبت تحویل`}
    >
      <Icon name="route" size="md" className="shrink-0 text-[var(--accent)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
          توقف {faNum(pill.index)} از {faNum(pill.total)} · {pill.name}
        </span>
        <span className="runpill__bar mt-1 block h-[3px] overflow-hidden rounded-full bg-[var(--border)]">
          <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%`, transition: "width 400ms ease" }} />
        </span>
      </span>
    </button>
  );
}
