import MapLoader from "@/components/MapLoader";
import { getDb } from "@/lib/db";
import { geometryVersion } from "@/lib/districtGeometry";
import { readCustomers } from "@/lib/customers";
import { readDistrictProperties } from "@/lib/districts";
import { readFacilities } from "@/lib/facilities";
import { geometryUrl } from "@/lib/precision";

// The map's opening data comes from the server, not from fetches fired after hydration.
// SQLite is local and these reads are sub-millisecond, so paying for them inline is
// far cheaper than the two extra round trips the client used to make -- which couldn't
// even start until the shell bundle had downloaded, parsed, hydrated and mounted the
// dynamically-imported map. Reading the DB isn't a dynamic API as far as Next is
// concerned, so the route has to opt out of static prerendering explicitly or the build
// would bake one snapshot of the data into the HTML forever.
export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const districts = readDistrictProperties(db);
  const customers = readCustomers(db);
  const facilities = readFacilities(db);
  const version = geometryVersion();

  return (
    <>
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
        geometryVersion={version}
      />
    </>
  );
}
