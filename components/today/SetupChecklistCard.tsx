import Link from "next/link";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";
import type { SetupStep } from "@/lib/setupChecklist";

/** FB19 on «امروز» for the owner: what is left to set up, how long it takes, and how far along the company is. Ticks itself from real data. */
export default function SetupChecklistCard({ steps, percent, minutesLeft }: { steps: SetupStep[]; percent: number; minutesLeft: number }) {
  return (
    <section className="card mb-3 flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="setup-checklist" aria-label="راه‌اندازی شرکت">
      <div className="flex items-baseline justify-between gap-[var(--space-2)]">
        <h3 className="sechead__title m-0">راه‌اندازی شرکت</h3>
        <span className="tabular-nums text-[length:var(--text-xs)] text-[var(--muted)]">{faNum(percent)}٪ · حدود {faNum(minutesLeft)} دقیقه مانده</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="پیشرفت راه‌اندازی" className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${percent}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
        {steps.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="flex min-h-[44px] items-center gap-[var(--space-2)] no-underline" style={{ color: s.done ? "var(--muted)" : "var(--foreground)" }}>
              <Icon name={s.done ? "check" : "arrow-left"} size="sm" />
              <span className={s.done ? "line-through" : ""}>{s.label}</span>
              {s.done ? null : <span className="ms-auto text-[length:var(--text-xs)] text-[var(--muted)]">{faNum(s.minutes)} دقیقه</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
