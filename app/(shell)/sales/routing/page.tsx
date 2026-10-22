import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

import { listVehicles } from "@/lib/repo/routing";
import RoutingPlanner from "@/components/sales/RoutingPlanner";
import PageHeader from "@/components/meridian/PageHeader";

import { MANAGE_ROLES } from "@/lib/roles";
export const dynamic = "force-dynamic";

export default async function RoutingPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const vehicles = listVehicles(session.organizationId, false);
  const names: Record<number, string> = {};
  for (const v of vehicles) names[v.id] = v.plate ? `${v.name} (${v.plate})` : v.name;

  return (
    <>
    <PageHeader route="/sales/routing" />
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>مسیریابی تحویل</h2>
          <div className="n">
            {vehicles.length === 0
              ? "هنوز خودرویی ثبت نشده — پیشنهاد با یک خودروی فرضی ساخته می‌شود"
              : `${vehicles.length} خودرو`}
          </div>
        </div>
      </div>
      <div className="kblock__body">
        <RoutingPlanner vehicleNames={names} />
      </div>
    </div>    </>
  );
}
