import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { repHealth, REP_HEALTH_BAND_FA } from "@/lib/repo/repHealth";
import { REP_STAGE_LABEL, type RepStage } from "@/lib/repStages";
import { repsRepo, listOnboarding } from "@/lib/repo/representatives";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";

export const dynamic = "force-dynamic";

export default async function RepDetail({ params }: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!["owner", "group_manager", "rep_manager"].includes(session.role)) redirect("/sales");

  getDb();
  const id = Number((await params).id);
  const rep = repsRepo.get(session.organizationId, id);
  if (!rep) notFound();
  const health = repHealth(session.organizationId, id);
  const steps = listOnboarding(session.organizationId, id);

  return (
    <div className="kblock flex flex-col gap-[var(--space-4)] p-[var(--space-4)]" dir="rtl">
      <div>
        <Link href="/sales/reps" className="text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline">
          ← همه نمایندگان
        </Link>
        <h2 className="m-0 mt-[var(--space-1)]">{rep.rep_code}</h2>
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          مرحله: {REP_STAGE_LABEL[rep.stage as RepStage] ?? rep.stage} · سلامت {faNum(health.score)} (
          {REP_HEALTH_BAND_FA[health.band]})
        </p>
      </div>

      <section className="grid grid-cols-3 gap-[var(--space-2)] text-center text-[length:var(--text-sm)]">
        {(
          [
            ["راه‌اندازی", health.factors.onboarding],
            ["فعالیت اخیر", health.factors.recency],
            ["پوشش محصول", health.factors.coverage],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-2)]">
            <div className="text-[length:var(--text-lg)] font-medium tabular-nums">{faNum(v)}</div>
            <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="m-0 mb-[var(--space-1)] text-[length:var(--text-sm)] font-medium">مراحل راه‌اندازی</h3>
        <ul className="m-0 list-none p-0 text-[length:var(--text-sm)]">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-b border-[var(--border)] py-[var(--space-1)]">
              <span className={s.completed_at ? "text-[var(--text-muted)] line-through" : "text-[var(--text)]"}>
                {s.label_fa}
              </span>
              <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">
                {s.completed_at ? <Icon name="check" size="sm" /> : "در انتظار"}
              </span>
            </li>
          ))}
          {steps.length === 0 && <li className="text-[var(--text-faint)]">مرحله‌ای تعریف نشده</li>}
        </ul>
      </section>
    </div>
  );
}
