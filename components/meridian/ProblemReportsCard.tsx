"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDateTime } from "@/lib/jalali";
import type { ProblemReportRow } from "@/lib/repo/problemReports";

/** «گزارش‌های مشکل», on the owner's status page (S24): what people reported, with the page, role, app version, phone
 *  and connection that came with it. Tap «دیدن تصویر» to open the screenshot, «انجام شد» to take it off the list. */
export default function ProblemReportsCard({ rows }: { rows: ProblemReportRow[] }) {
  const [list, setList] = useState(rows);
  const [shots, setShots] = useState<Record<number, string>>({});
  async function done(id: number) {
    const res = await fetch(`/api/problem-reports/${id}`, { method: "PATCH" }).catch(() => null);
    if (res?.ok) setList((l) => l.filter((r) => r.id !== id));
  }
  async function show(id: number) {
    const res = await fetch(`/api/problem-reports/${id}`).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { screenshot?: string } | undefined;
    if (j?.screenshot) setShots((s) => ({ ...s, [id]: j.screenshot as string }));
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="problem-reports">
      <h2 className="sechead__title">گزارش‌های مشکل</h2>
      {list.length === 0 ? <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">گزارشی باز نیست.</p> : null}
      {list.map((r) => (
        <article key={r.id} className="flex flex-col gap-[var(--space-1)] border-t border-[var(--border)] pt-[var(--space-3)] text-[length:var(--text-sm)]">
          <p className="m-0">{r.message}</p>
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">
            {r.who} · {r.page ?? "—"} · {faJalaliDateTime(r.created_at)}
          </p>
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]" dir="ltr">
            v{r.app_version ?? "?"} · {r.connection ?? "?"} · {(r.user_agent ?? "").slice(0, 80)}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- the report's own screenshot, a data URL */}
          {shots[r.id] ? <img src={shots[r.id]} alt="تصویر گزارش" className="max-h-80 w-auto self-start rounded-[var(--radius-md)]" /> : null}
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {r.has_screenshot && !shots[r.id] ? (
              <button type="button" onClick={() => void show(r.id)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)]">
                <Icon name="eye" size="sm" /> دیدن تصویر
              </button>
            ) : null}
            <button type="button" onClick={() => void done(r.id)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)]">
              <Icon name="check" size="sm" /> انجام شد
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
