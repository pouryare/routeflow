import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import { statusFacts } from "@/lib/repo/systemStatus";
import { statusLines, type Tone } from "@/lib/systemStatus";
import { faJalaliDateTime } from "@/lib/jalali";
import MaintenanceForm from "@/components/meridian/MaintenanceForm";
import { maintenanceFor } from "@/lib/repo/maintenance";
import AccessReviewCard from "@/components/meridian/AccessReviewCard";
import DocumentSettingsForm from "@/components/meridian/DocumentSettingsForm";
import TaskPushForm from "@/components/meridian/TaskPushForm";
import { taskPushMinutes } from "@/lib/repo/taskPush";
import { documentSettingsFor } from "@/lib/repo/documentSettings";
import { accessReview } from "@/lib/accessReview";
import { accessUsers, recentImpersonations } from "@/lib/repo/accessReview";

export const dynamic = "force-dynamic";

const TONE: Record<Tone, { label: string; color: string }> = {
  good: { label: "خوب", color: "var(--good)" },
  warn: { label: "نیاز به نگاه", color: "var(--warn)" },
  bad: { label: "خراب", color: "var(--crit)" },
  unknown: { label: "نامعلوم", color: "var(--text-faint)" },
};

/** F108: one page for the app's own health, for the owner (the admin layout gates it). */
export default async function StatusPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const lines = statusLines(await statusFacts(session.organizationId));
  const maintenance = await maintenanceFor(session.organizationId);
  const review = accessReview(await accessUsers(session.organizationId), new Date().toISOString());
  const logins = await recentImpersonations(session.organizationId);
  const docs = await documentSettingsFor(session.organizationId);
  const pushMinutes = await taskPushMinutes(session.organizationId);

  return (
    <>
      <PageHeader route="/sales/admin/status" />
      <section className="card p-[var(--space-4)]" dir="rtl">
        <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0 text-[length:var(--text-sm)]">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-3)]">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                <span className="font-medium text-[var(--text)]">{l.label}</span>
                <span style={{ color: TONE[l.tone].color }}>{TONE[l.tone].label}</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] text-[var(--text-muted)]">
                <span>{l.detail}</span>
                {l.at && <span className="tabular-nums">{faJalaliDateTime(l.at)}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="mt-[var(--space-4)]">
        <AccessReviewCard review={review} logins={logins} />
      </div>
      <div className="mt-[var(--space-4)]">
        <MaintenanceForm current={maintenance} />
      </div>
      <div className="mt-[var(--space-4)]">
        <DocumentSettingsForm current={docs} />
      </div>
      <div className="mt-[var(--space-4)]">
        <TaskPushForm minutes={pushMinutes} />
      </div>
    </>
  );
}
