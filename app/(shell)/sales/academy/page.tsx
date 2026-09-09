import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { listObjectionCards, academyManifest, lessonProgress } from "@/lib/repo/academy";
import AcademyLibrary from "@/components/sales/AcademyLibrary";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

export default async function AcademyPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  getDb();
  const cards = listObjectionCards(session.organizationId).sort((a, b) =>
    a.outcome_code.localeCompare(b.outcome_code)
  );
  const modules = academyManifest();
  const done = lessonProgress(session.organizationId, session.user.id).map((p) => p.lesson_slug);

  return (
    <>
    <PageHeader route="/sales/academy" />
    <div className="kblock p-[var(--space-4)]" dir="rtl">
      <div className="bhead">
        <div>
          <h2>آموزش</h2>
          <div className="n">درس‌ها و پاسخ به مخالفت مشتری</div>
        </div>
      </div>
      <AcademyLibrary cards={cards} modules={modules} done={done} />
    </div>    </>
  );
}
