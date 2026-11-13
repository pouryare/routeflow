import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { academyManifest, lessonBody, lessonProgress } from "@/lib/repo/academy";
import { companyLessonId, getCompanyLesson, stillDone } from "@/lib/repo/academyLessons";
import { isOwner } from "@/lib/roles";
import { Icon } from "@/components/meridian/Icon";
import LessonBody from "@/components/academy/LessonBody";
import LessonDone from "@/components/academy/LessonDone";

export const metadata = { title: "درس" };

export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  let title: string;
  let text: string;
  let draft = false;
  let done = false;
  const progress = (await lessonProgress(session.organizationId, session.user.id)).find((p) => p.lesson_slug === slug);

  const id = companyLessonId(slug);
  if (id !== null) {
    const l = await getCompanyLesson(session, id);
    if (!l) notFound();
    title = l.title;
    text = l.body;
    draft = l.status === "draft";
    done = !!progress && stillDone(l, Number(progress.version_read));
  } else {
    const m = academyManifest().find((x) => x.slug === slug);
    const body = m ? lessonBody(slug) : null;
    if (!m || body === null) notFound();
    if (m.audience?.length && !isOwner(session.role) && !m.audience.some((r) => session.hasRole(r as never))) notFound();
    title = m.title_fa;
    text = body;
    done = !!progress;
  }

  return (
    <div className="kblock p-[var(--space-4)]" dir="rtl">
      <Link href="/sales/academy" className="acad__muted inline-flex items-center gap-[var(--space-2)] min-h-[44px]">
        <Icon name="arrow-right" size="sm" /> آموزش
      </Link>
      <h2 style={{ marginTop: 4 }}>{title}</h2>
      {draft && <p className="acad__chip">پیش‌نویس؛ فقط نویسندگان آن را می‌بینند</p>}
      <LessonBody text={text} />
      {!draft && <LessonDone slug={slug} done={done} />}
      <div className="sticky-action-gap" />
    </div>
  );
}
