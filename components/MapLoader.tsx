"use client";

import dynamic from "next/dynamic";
import { CustomerRow, DistrictProperties } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";
import type { Role } from "@/lib/db";
import type { MapGroup } from "@/components/CoverageMap";

const CoverageMap = dynamic(() => import("@/components/CoverageMap"), {
  ssr: false,
  /* The splash used to carry `meridian` itself, because the scope lived on CoverageMap's
     own root and this stands in for CoverageMap until the chunk arrives. It now inherits
     the scope from app/(shell)/layout.tsx like every other route, so repeating it here
     would be a second, nested copy — and `h-screen` inside the shell's padded `.app`
     overflows by the height of the header. A tall-but-bounded box holds the space
     without pushing the page. */
  loading: () => (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4">
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
