import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { homePathFor, isVanRole } from "@/lib/roles";
import { getDb } from "@/lib/db";
import { todayFor } from "@/lib/repo/briefing";
import Briefing from "@/components/today/Briefing";
import RolePicker from "@/components/today/RolePicker";
import { faJalaliLong } from "@/lib/jalali";
import NotificationBell from "@/components/NotificationBell";

export const dynamic = "force-dynamic";

/** Where a person starts their day.
 *
 *  A single-role person is sent straight to the world that role belongs to, unchanged. But
 *  someone holding SEVERAL roles must not be redirected before they can choose — a driver
 *  who also sells, currently on `field_rep`, would be bounced to /sales/today and never see
 *  the picker that lets them go back. So the redirect applies only to people with one role;
 *  everyone else lands here, sees the picker, and their briefing renders for the role they
 *  are currently in. */
export default async function TodayPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.roles.length < 2 && !isVanRole(session.role)) redirect(homePathFor(session.role));

  getDb();
  const data = todayFor(session);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-[var(--space-4)] py-[var(--space-5)]" dir="rtl">
      <header className="mb-[var(--space-4)]">
        <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">امروز</h1>
        <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {session.user.display_name} · {faJalaliLong(new Date().toISOString())}
        </p>
      </header>
      <RolePicker roles={session.roles} active={session.role} />
      <Briefing data={data} />
      <NotificationBell />
    </main>
  );
}
