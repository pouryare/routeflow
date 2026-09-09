"use client";

import dynamic from "next/dynamic";
import { CustomerRow, DistrictProperties } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";
import type { Role } from "@/lib/db";
import type { MapGroup } from "@/components/CoverageMap";

const CoverageMap = dynamic(() => import("@/components/CoverageMap"), {
  ssr: false,
  /* The splash carries `meridian` itself.
     It cannot inherit it: the scope lives on CoverageMap's own root, and this is what
     stands in for CoverageMap until the chunk arrives — so without the class the first
     thing anyone sees on the map is the pre-redesign ground, then a jump to the warm one. */
  loading: () => (
    <div className="meridian flex h-screen w-full flex-col items-center justify-center gap-4">
      <div className="side__mark" style={{ width: 52, height: 52, borderRadius: 17, fontSize: 21 }}>
        ن
      </div>
      <p className="m-0 text-[13.5px]" style={{ color: "var(--muted)" }}>
        در حال بارگذاری نقشه…
      </p>
    </div>
  ),
});

export default function MapLoader(props: {
  initialDistricts: DistrictProperties[];
  initialCustomers: CustomerRow[];
  initialFacilities: FacilityRow[];
  groups: MapGroup[];
  role: Role;
  geometryVersion: string;
}) {
  return <CoverageMap {...props} />;
}
