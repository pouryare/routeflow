import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { todayFor } from "@/lib/repo/briefing";
import Briefing from "@/components/today/Briefing";
import SweepButton from "@/components/SweepButton";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

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
          <h2>امروز</h2>
          <div className="n">{session.user.display_name}</div>
        </div>
        {(session.role === "owner" || session.role === "group_manager") && (
          <SweepButton endpoint="/api/rules/run" idleLabel="به‌روزرسانی کارها" />
        )}
      </div>

      <Briefing data={data} variant="meridian" />
    </div>    </>
  );
}
