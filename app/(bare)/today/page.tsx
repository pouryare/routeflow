import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { homePathFor, isVanRole } from "@/lib/roles";
import NotAVanNotice from "@/components/meridian/NotAVanNotice";
import { getDb } from "@/lib/db";
import { todayFor } from "@/lib/repo/briefing";
import Briefing from "@/components/today/Briefing";
import BriefingHero from "@/components/today/BriefingHero";
import { cardFor } from "@/lib/repo/briefingCards";
import { roleLabel, type Role } from "@/lib/roles";
import RolePicker from "@/components/today/RolePicker";
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
  if (session.roles.length < 2 && !isVanRole(session.role)) {
    /* Same rule as /driver: a platform_owner gets the notice and a way forward, everyone
       else is still redirected. The `roles.length < 2` test stays OUTSIDE this — a
       multi-role person landing here is a feature (the picker), not a dead end, and only
       the founder's single-role founder account is the case the spec means. */
    if (session.role === "platform_owner") return <NotAVanNotice />;
    redirect(homePathFor(session.role));
  }

  getDb();
  const data = todayFor(session);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-[var(--space-4)] py-[var(--space-5)]" dir="rtl">
      {/* The hero replaces the hand-rolled header: same facts (name, role, date) with the
          photo and the one number attached. The role picker stays directly beneath it, which
          is where the decision at the top of the plan puts it. */}
      <BriefingHero
        data={data}
        card={cardFor(data.panels)}
        roleLabel={roleLabel(session.role)}
        dateIso={new Date().toISOString()}
      />
      <RolePicker roles={session.roles} active={session.role} />
      <Briefing data={data} />
      <NotificationBell />
    </main>
  );
}
