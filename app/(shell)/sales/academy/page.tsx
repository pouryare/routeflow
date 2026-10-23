import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

import { listObjectionCards, academyManifest, lessonProgress, trainingStatus } from "@/lib/repo/academy";
import AcademyPath from "@/components/sales/AcademyPath";
import TrainingTable from "@/components/sales/TrainingTable";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

export default async function AcademyPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  const cards = (await listObjectionCards(session.organizationId)).sort((a, b) =>
    a.outcome_code.localeCompare(b.outcome_code)
  );
  const modules = academyManifest();
  const done = (await lessonProgress(session.organizationId, session.user.id)).map((p) => p.lesson_slug);
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
      </div>
      <div className="kblock__body">
        <AcademyPath cards={cards} modules={modules} done={done} />
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
