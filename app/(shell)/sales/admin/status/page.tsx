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
import ProblemReportsCard from "@/components/meridian/ProblemReportsCard";
import { openProblemReports } from "@/lib/repo/problemReports";
import IdleSignoutForm from "@/components/meridian/IdleSignoutForm";
import { idleRulesFor } from "@/lib/repo/idleSignout";
import { thresholdsFor } from "@/lib/repo/thresholds";
import ThresholdsForm from "@/components/meridian/ThresholdsForm";
import { taskPushMinutes } from "@/lib/repo/taskPush";
import { documentSettingsFor } from "@/lib/repo/documentSettings";
import { invoiceSettingsFor } from "@/lib/repo/invoice";
import InvoiceSettingsForm from "@/components/meridian/InvoiceSettingsForm";
import { accessReview } from "@/lib/accessReview";
import { accessUsers, recentImpersonations } from "@/lib/repo/accessReview";
import { pageMetadata } from "@/lib/pageMeta";
import LiveConnectionsCard from "@/components/meridian/LiveConnectionsCard";
import { connectionsOf } from "@/lib/repo/liveConnections";
import SlowQueriesCard from "@/components/meridian/SlowQueriesCard";
import { slowQueries } from "@/lib/repo/slowQueries";
import AuditHistoryCard from "@/components/meridian/AuditHistoryCard";
import { auditHistory } from "@/lib/repo/auditLog";
import ArchiveMonthsForm from "@/components/meridian/ArchiveMonthsForm";
import LogRetentionForm from "@/components/meridian/LogRetentionForm";
import { retentionPreview } from "@/lib/repo/logRetention";
import { archiveHotMonths } from "@/lib/repo/historyArchive";

export const metadata = pageMetadata("/sales/admin/status");

export const dynamic = "force-dynamic";

const TONE: Record<Tone, { label: string; color: string }> = {
  good: { label: "خوب", color: "var(--success)" },
  warn: { label: "نیاز به نگاه", color: "var(--warning)" },
  bad: { label: "خراب", color: "var(--danger)" },
  unknown: { label: "نامعلوم", color: "var(--text-faint)" },
};

/** F108: one page for the app's own health, for the owner (the admin layout gates it). */
export default async function StatusPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const limits = await thresholdsFor(session.organizationId);
  const idleRules = await idleRulesFor(session.organizationId);
  const reports = await openProblemReports(session.organizationId);
  const lines = statusLines({ ...(await statusFacts(session.organizationId)), dataAgeingDays: limits.data_ageing_days, dataStaleDays: limits.data_stale_days });
  const maintenance = await maintenanceFor(session.organizationId);
  const review = accessReview(await accessUsers(session.organizationId), new Date().toISOString());
  const logins = await recentImpersonations(session.organizationId);
  const docs = await documentSettingsFor(session.organizationId);
  const invoiceSettings = await invoiceSettingsFor(session.organizationId);
  const pushMinutes = await taskPushMinutes(session.organizationId);
  const connections = await connectionsOf(session.organizationId);
  const changes = await auditHistory(session.organizationId, { limit: 100 });
  // The query counters are the whole server's, every company's together: the platform owner's only.
  const platform = session.hasRole("platform_owner");
  const slow = platform ? await slowQueries() : undefined;
  const hotMonths = platform ? await archiveHotMonths() : undefined;
  const retention = platform ? await retentionPreview() : undefined;

  return (
    <>
      <PageHeader route="/sales/admin/status" />
      <section className="card p-[var(--space-4)]" dir="rtl">
        <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0 text-[length:var(--text-sm)]">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-3)]">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                <span className="font-medium text-[var(--foreground)]">{l.label}</span>
                <span style={{ color: TONE[l.tone].color }}>{TONE[l.tone].label}</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] text-[var(--muted)]">
                <span>{l.detail}</span>
                {l.at && <span className="tabular-nums">{faJalaliDateTime(l.at)}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="mt-[var(--space-4)]">
        <ProblemReportsCard rows={reports} />
      </div>
      <div className="mt-[var(--space-4)]">
        <LiveConnectionsCard rows={connections} />
      </div>
      <div className="mt-[var(--space-4)]">
        <AuditHistoryCard rows={changes} />
      </div>
      {slow !== undefined ? (
        <div className="mt-[var(--space-4)]">
          <SlowQueriesCard data={slow} />
        </div>
      ) : null}
      {hotMonths !== undefined ? (
        <div className="mt-[var(--space-4)]">
          <ArchiveMonthsForm months={hotMonths} />
        </div>
      ) : null}
      {retention !== undefined ? (
        <div className="mt-[var(--space-4)]">
          <LogRetentionForm rows={retention} />
        </div>
      ) : null}
      <div className="mt-[var(--space-4)]">
        <AccessReviewCard review={review} logins={logins} />
      </div>
      <div className="mt-[var(--space-4)]">
        <MaintenanceForm current={maintenance} />
      </div>
      <div className="mt-[var(--space-4)]">
        <DocumentSettingsForm current={docs} />
        <InvoiceSettingsForm current={invoiceSettings} />
      </div>
      <div className="mt-[var(--space-4)]">
        <TaskPushForm minutes={pushMinutes} />
      </div>
      <div className="mt-[var(--space-4)]">
        <ThresholdsForm values={limits} />
      </div>
      <div className="mt-[var(--space-4)]">
        <IdleSignoutForm rules={idleRules} />
      </div>
    </>
  );
}
