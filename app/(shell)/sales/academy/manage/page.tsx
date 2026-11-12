import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { canAuthorLessons, canEditLesson, listCategories, listCompanyLessons, listPeopleForTrainers } from "@/lib/repo/academyLessons";
import { isOwner, ROLES } from "@/lib/roles";
import { Icon } from "@/components/meridian/Icon";
import LessonManager from "@/components/academy/LessonManager";

export const dynamic = "force-dynamic";

/** Where the owner, a group manager or a «مربی» writes the company's own lessons (AC3). */
export default async function ManageLessonsPage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!canAuthorLessons(session)) redirect("/sales/academy");

  const [categories, all, people] = await Promise.all([listCategories(session.organizationId), listCompanyLessons(session), listPeopleForTrainers(session)]);
  const lessons = all.filter((l) => canEditLesson(session, l)).map((l) => ({
    id: l.id, title: l.title, category_id: l.category_id, body: l.body, roles: l.roles,
    required: Boolean(l.required), due_days: l.due_days === null ? null : Number(l.due_days), status: l.status,
  }));

  return (
    <div className="kblock p-[var(--space-4)]" dir="rtl">
      <Link href="/sales/academy" className="acad__muted inline-flex items-center gap-[var(--space-2)] min-h-[44px]">
        <Icon name="arrow-right" size="sm" /> آموزش
      </Link>
      <h2 style={{ marginTop: 4 }}>مدیریت درس‌ها</h2>
      <div className="kblock__body">
        <LessonManager lessons={lessons} categories={categories.map((c) => ({ id: c.id, title: c.title }))} roles={ROLES} people={people} isOwner={isOwner(session.role)} />
      </div>
    </div>
  );
}
