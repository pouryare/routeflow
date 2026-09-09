import Link from "next/link";
import TaskRow from "./TaskRow";
import type { Briefing as BriefingData, BriefingItem } from "@/lib/repo/briefing";

/** "plain" is the driver's standalone /today (generic tokens, phone-width column).
 *  "kargah" is the /sales/today tab — the same panels dressed in the workshop skin so it
 *  sits flush with every other sales screen. */
type Variant = "plain" | "kargah";

const TONE_PLAIN: Record<string, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  info: "var(--info)",
};
const TONE_KARGAH: Record<string, string> = {
  good: "var(--sage)",
  warn: "var(--amber)",
  crit: "var(--crit)",
  info: "var(--serie-b)",
};

function Item({ item, variant }: { item: BriefingItem; variant: Variant }) {
  if (item.action?.kind === "task_outcome") {
    return <TaskRow taskId={item.action.task_id} label={item.label} sub={item.sub} />;
  }
  const tone = variant === "kargah" ? TONE_KARGAH : TONE_PLAIN;
  const inner = (
    <span className="flex items-baseline justify-between gap-[var(--space-2)]">
      <span
        className={variant === "kargah" ? "text-[var(--ink)]" : "text-[var(--text)]"}
        style={item.tone ? { color: tone[item.tone] } : undefined}
      >
        {item.label}
      </span>
      {item.sub && (
        <span
          className={
            variant === "kargah"
              ? "text-[length:12px] text-[var(--muted)]"
              : "text-[length:var(--text-xs)] text-[var(--text-faint)]"
          }
        >
          {item.sub}
        </span>
      )}
    </span>
  );
  return (
    <li
      className={
        variant === "kargah"
          ? "border-b border-[var(--line)] py-[10px] last:border-b-0"
          : "border-b border-[var(--border)] py-[var(--space-2)]"
      }
    >
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

export default function Briefing({
  data,
  variant = "plain",
}: {
  data: BriefingData;
  variant?: Variant;
}) {
  if (data.panels.length === 0) {
    return variant === "kargah" ? (
      <p
        style={{
          fontSize: 13,
          color: "var(--muted)",
          padding: "28px 22px",
          border: "1px dashed var(--line-2)",
          borderRadius: 14,
        }}
      >
        امروز چیزی نیاز به اقدام شما ندارد.
      </p>
    ) : (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
        امروز چیزی نیاز به اقدام شما ندارد.
      </p>
    );
  }

  if (variant === "kargah") {
    return (
      <div className="flex flex-col gap-[14px]" dir="rtl">
        {data.panels.map((p) => (
          <div key={p.key} className="kblock">
            <div className="bhead">
              <div>
                <h2>{p.title}</h2>
                {p.more ? <div className="n">+ {p.more} مورد بیشتر</div> : null}
              </div>
            </div>
            <ul className="m-0 list-none p-0" style={{ padding: "0 22px 16px" }}>
              {p.items.map((it, i) => (
                <Item key={i} item={it} variant="kargah" />
              ))}
            </ul>
          </div>
        ))}
      </div>
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
              <Item key={i} item={it} variant="plain" />
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
