import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import LoginEventList from "@/components/LoginEventList";
import { recentLogins } from "@/lib/repo/loginEvents";

export const dynamic = "force-dynamic";

/** F110: the organisation's last 100 sign-in attempts, for the owner (the admin layout gates it). */
export default async function LoginLogPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const rows = recentLogins(session.organizationId, 100);

  return (
    <>
      <PageHeader route="/sales/admin/logins" />
      <section className="card p-[var(--space-4)]" dir="rtl">
        <LoginEventList rows={rows} showName />
      </section>
    </>
  );
}
