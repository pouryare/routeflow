import MapLoader from "@/components/MapLoader";
import { geometryVersion } from "@/lib/districtGeometry";
import { geometryUrl } from "@/lib/precision";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { mapPageData } from "@/lib/repo/mapPageView";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

// The map's opening data comes from the server, not from fetches fired after hydration.
// SQLite is local and these reads are sub-millisecond, so paying for them inline is
// far cheaper than the two extra round trips the client used to make -- which couldn't
// even start until the shell bundle had downloaded, parsed, hydrated and mounted the
// dynamically-imported map. Reading the DB isn't a dynamic API as far as Next is
// concerned, so the route has to opt out of static prerendering explicitly or the build
// would bake one snapshot of the data into the HTML forever.
export const dynamic = "force-dynamic";

// A server component reads the DB directly, so it has to resolve the session itself --
// proxy.ts only proves someone is signed in, not which group's data they may see.
export default async function Home() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  const { districts, customers, facilities, initialLeads, visibleGroups } = mapPageData(session);
  const version = geometryVersion();

  return (
    <>
    <PageHeader route="/map" />
      {/* React hoists this into <head>, so the browser starts pulling the polygons
          while the JS bundle is still downloading instead of after it runs.
          crossOrigin="use-credentials" is load-bearing: a preload only satisfies a
          later fetch() when their mode and credentials agree. Without it the link is
          a no-cors request, CoverageMap's fetch() is a credentialed cors one, nothing
          matches, and the geometry downloads twice. The matching fetch therefore has
          to pass credentials: "include" -- see the geometry effect in CoverageMap. */}
      <link rel="preload" as="fetch" crossOrigin="use-credentials" href={geometryUrl(version, "low")} />
      <MapLoader
        initialDistricts={districts}
        initialCustomers={customers}
        initialFacilities={facilities}
        initialLeads={initialLeads}
        groups={visibleGroups}
        role={session.role}
        geometryVersion={version}
      />
    </>
  );
}
