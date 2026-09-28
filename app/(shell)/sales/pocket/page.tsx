import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { pocketFor, pocketTeam } from "@/lib/repo/pocket";
import Pocket from "@/components/pocket/Pocket";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The member's personal home — the /today briefing shaped like the /sales dashboard.
 *  Everyone but a driver (who has their own screen); a manager also gets a team strip. */
export default async function PocketPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  getDb();

  // pocketFor / pocketTeam return fresh object literals — safe across the boundary.
  return (
    <>
    <PageHeader route="/sales/pocket" />
    <Pocket
      initial={pocketFor(session, {})}
      team={pocketTeam(session)}
      viewerName={session.user.display_name}
    />    </>
  );
}
