import Link from "next/link";
import TaskRow from "./TaskRow";
import type { Briefing as BriefingData, BriefingItem } from "@/lib/repo/briefing";

const TONE: Record<string, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  info: "var(--info)",
};

function Item({ item }: { item: BriefingItem }) {
  if (item.action?.kind === "task_outcome") {
    return <TaskRow taskId={item.action.task_id} label={item.label} sub={item.sub} />;
  }
  const inner = (
    <span className="flex items-baseline justify-between gap-[var(--space-2)]">
      <span className="text-[var(--text)]" style={item.tone ? { color: TONE[item.tone] } : undefined}>
        {item.label}
      </span>
      {item.sub && <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">{item.sub}</span>}
    </span>
  );
  return (
    <li className="border-b border-[var(--border)] py-[var(--space-2)]">
      {item.href ? (
        <Link href={item.href} className="block no-underline hover:opacity-80">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

export default function Briefing({ data }: { data: BriefingData }) {
  if (data.panels.length === 0) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
        امروز چیزی نیاز به اقدام شما ندارد.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
      {data.panels.map((p) => (
        <section key={p.key} className="rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-3)]">
          <h3 className="m-0 mb-[var(--space-1)] text-[length:var(--text-sm)] font-medium text-[var(--text)]">
            {p.title}
          </h3>
          <ul className="m-0 list-none p-0">
            {p.items.map((it, i) => (
              <Item key={i} item={it} />
            ))}
          </ul>
          {p.more ? (
            <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
              + {p.more} مورد بیشتر
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
