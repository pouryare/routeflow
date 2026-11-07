import { CardHelp } from "@/components/meridian/CardHelp";
import Link from "next/link";
import { customerHref } from "@/lib/deepLink";

export interface ChurnRow {
  customer_id: number;
  business_name: string;
  probability: number;
  band: string;
  reason_fa: string | null;
}

const BAND: Record<string, { label: string; tone: string }> = {
  high: { label: "بالا", tone: "var(--danger)" },
  watch: { label: "مراقبت", tone: "var(--warning)" },
  low: { label: "پایین", tone: "var(--success)" },
};

/** The `high` then `watch` customers — where the churn model wants a call. */
export default function ChurnList({ rows }: { rows: ChurnRow[] }) {
  const shown = rows.filter((r) => r.band !== "low").slice(0, 20);
  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <h2>خطر ریزش مشتری</h2>
        <div className="n">
          بالا {rows.filter((r) => r.band === "high").length.toLocaleString("fa-IR")} · مراقبت{" "}
          {rows.filter((r) => r.band === "watch").length.toLocaleString("fa-IR")}
        </div>
        <CardHelp id="card.churn" />
      </div>
      <div className="kblock__body">
      {shown.length === 0 ? (
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          مشتری پرخطری شناسایی نشده.
        </p>
      ) : (
        <ul className="m-0 list-none p-0 text-[length:var(--text-sm)]">
          {shown.map((r) => (
            <li
              key={r.customer_id}
              className="flex items-center justify-between border-b border-[var(--border)] py-[var(--space-1)]"
            >
              <Link
                href={customerHref(r.customer_id)}
                className="text-[var(--foreground)] no-underline hover:text-[var(--accent)]"
              >
                {r.business_name}
              </Link>
              <span className="flex items-center gap-[var(--space-2)] tabular-nums text-[var(--muted)]">
                <span>{r.reason_fa ?? ""}</span>
                <span style={{ color: BAND[r.band]?.tone ?? "var(--muted)" }}>
                  {Math.round(r.probability * 100).toLocaleString("fa-IR")}٪ · {BAND[r.band]?.label ?? "نامشخص"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
