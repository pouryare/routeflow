import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import { notesFor } from "@/lib/whatsNew";
import { faJalaliDate } from "@/lib/jalali";

export const dynamic = "force-dynamic";

/** F112: every what's-new entry that concerns the reader's role, newest first. */
export default async function UpdatesPage() {
  const session = getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const entries = notesFor(session.role);

  return (
    <>
      <PageHeader route="/settings/updates" />
      <div className="flex flex-col gap-[var(--space-4)]">
        {entries.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">هنوز تغییری برای نقش شما ثبت نشده است.</p>
        ) : (
          entries.map((e) => (
            <section key={e.version} className="card p-[var(--space-4)]">
              <h2 className="sechead__title">{faJalaliDate(e.version)}</h2>
              <ul className="m-0 mt-[var(--space-2)] flex list-disc flex-col gap-[var(--space-1)] pr-[var(--space-4)] text-[length:var(--text-sm)] leading-6">
                {e.items.map((i, k) => (
                  <li key={k}>{i.text}</li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
