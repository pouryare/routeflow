import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

import Link from "next/link";
import { listObjectionCards, academyOverview, trainingStatus } from "@/lib/repo/academy";
import { canAuthorLessons } from "@/lib/repo/academyLessons";
import { Icon } from "@/components/meridian/Icon";
import AcademyPath from "@/components/sales/AcademyPath";
import TrainingTable from "@/components/sales/TrainingTable";
import PageHeader from "@/components/meridian/PageHeader";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/academy");

export const dynamic = "force-dynamic";

export default async function AcademyPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  const cards = (await listObjectionCards(session.organizationId)).sort((a, b) =>
    a.outcome_code.localeCompare(b.outcome_code)
  );
  const items = await academyOverview(session);
  // F133: managers and the owner also see who has finished the lessons their roles require.
  const training = await trainingStatus(session);

  return (
    <>
    <PageHeader route="/sales/academy" />
    <div className="kblock p-[var(--space-4)]" dir="rtl">
      <div className="bhead">
        <div>
          <h2>آموزش</h2>
          <div className="n">مسیر درس‌ها، و پاسخ آماده به مخالفت‌های رایج مشتری</div>
        </div>
        {canAuthorLessons(session) && (
          <Link href="/sales/academy/manage" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" data-tour="academy-manage">
            <Icon name="edit" size="md" /> مدیریت درس‌ها
          </Link>
        )}
      </div>
      <div className="kblock__body">
        <AcademyPath cards={cards} items={items} />
      </div>
    </div>
    {training && (
      <div className="kblock p-[var(--space-4)]" dir="rtl" style={{ marginTop: 14 }}>
        <div className="bhead">
          <div>
            <h2>درس‌های اجباری تیم</h2>
            <div className="n">چه کسی درس‌های لازمِ نقشش را تمام کرده است</div>
          </div>
        </div>
        <div className="kblock__body">
          <TrainingTable lessons={training.lessons} people={training.people} />
        </div>
      </div>
    )}
    </>
  );
}
