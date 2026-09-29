"use client";

import { useState } from "react";
import DriverRunView from "@/components/driver/DriverRunView";
import LocationTapFlow from "@/components/leads/LocationTapFlow";
import { useNavApp } from "@/components/NavAppSetting";
import type { DriverRun } from "@/components/driver/useDriverRun";

/** The visits section of /driver, and the sheet that records one.
 *
 *  A client wrapper for one reason: `DriverRunView` takes an `onRecord` callback, and a
 *  server component cannot hand a function to a client component. The page passes
 *  `initialRun` down; this holds the tap-flow's open/close state underneath it.
 *
 *  Position arrives from MyPositionProvider, which is mounted in this route group. Before
 *  that, the map below had no blue dot and the next-stop banner had no distance, and
 *  nothing said so.
 *
 *  The sheet's own heading is thinner here than it was on /leads: that page read the
 *  pin's name and coordinates out of the pool's `byId` map, and /driver has no pool. The
 *  sheet still records the outcome, which is the work. A follow-up could hand it the
 *  `DriverStop` the banner already holds; that is not this plan. */
export default function DriverDaySection({ initialRun }: { initialRun?: DriverRun | null }) {
  const [navAppId] = useNavApp();
  const [tapFlowId, setTapFlowId] = useState<number | null>(null);

  return (
    <>
      <DriverRunView
        initialRun={initialRun}
        onRecord={setTapFlowId}
        navAppId={navAppId}
      />
      <LocationTapFlow
        open={tapFlowId !== null}
        locationId={tapFlowId!}
        locationName=""
        locationLat={null}
        locationLng={null}
        navAppId={navAppId}
        onNavigate={(url) => window.open(url, "_blank")}
        onClose={() => setTapFlowId(null)}
      />
    </>
  );
}
