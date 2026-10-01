import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { todayFor } from "@/lib/repo/briefing";
import Briefing from "@/components/today/Briefing";
import BriefingHero from "@/components/today/BriefingHero";
import { cardFor } from "@/lib/repo/briefingCards";
import RolePicker from "@/components/today/RolePicker";
import SweepButton from "@/components/SweepButton";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole, roleLabel, type Role } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The daily briefing as a first-class /sales tab — same workshop chrome and travelling
 *  pill as every other screen. The bare /today route still exists for the driver (who
 *  never enters the sales shell); everyone else is redirected here. */
export default async function SalesTodayPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  getDb();
  const data = todayFor(session);

  return (
    <>
    <PageHeader route="/sales/today" />
    <div style={{ marginTop: 14 }}>
      <div
        className="bhead"
        style={{
          padding: 0,
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          {/* The hero above already says who this is and what needs them; this row keeps the
              page title and the controls that belong beside it. */}
          <h2>امروز</h2>
        </div>
        {/* The same picker the bare /today page shows, so someone holding several roles can
            leave the sales world as readily as they entered it. Without it here, a dual-hat
            person who lands in the sales shell has no way back to their van card. */}
        <RolePicker roles={session.roles} active={session.role} />
        {(session.role === "owner" || session.role === "group_manager") && (
          <SweepButton endpoint="/api/rules/run" idleLabel="به‌روزرسانی کارها" />
        )}
      </div>

      <BriefingHero
        data={data}
        card={cardFor(data.panels)}
        roleLabel={roleLabel(session.role)}
        dateIso={new Date().toISOString()}
      />

      <Briefing data={data} variant="meridian" />
    </div>    </>
  );
}
