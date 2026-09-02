import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { todayFor } from "@/lib/repo/briefing";
import Briefing from "@/components/today/Briefing";
import { faJalaliLong } from "@/lib/jalali";

export const dynamic = "force-dynamic";

/** The driver's briefing. Everyone else is redirected to /sales/today, where the same
 *  panels render as a first-class sales tab; the driver never enters the sales shell, so
 *  their briefing stays here on the bare, phone-width route. */
export default async function TodayPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "platform_owner") redirect("/platform");
  if (session.role !== "driver") redirect("/sales/today");

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
      <Briefing data={data} />
    </main>
  );
}
