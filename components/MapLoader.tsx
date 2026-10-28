"use client";

import { SkeletonBlock, SkeletonLabel } from "@/components/Skeleton";
import dynamic from "next/dynamic";
import { CustomerRow, DistrictProperties } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";
import type { Role } from "@/lib/db";
import type { MapGroup } from "@/components/CoverageMap";
import WidgetBoundary from "@/components/WidgetBoundary";

const CoverageMap = dynamic(() => import("@/components/CoverageMap"), {
  ssr: false,
  /* The splash used to carry `meridian` itself, because the scope lived on CoverageMap's
     own root and this stands in for CoverageMap until the chunk arrives. It now inherits
     the scope from app/(shell)/layout.tsx like every other route, so repeating it here
     would be a second, nested copy — and `h-screen` inside the shell's padded `.app`
     overflows by the height of the header. A tall-but-bounded box holds the space
     without pushing the page. */
  loading: () => (
    /* The map's own silhouette while its chunk loads. It used to be the pre-rename «ن»
       tile (item 28), which survived here after the sidebar copy was fixed. */
    <div className="flex w-full flex-col gap-2" aria-busy="true">
      <SkeletonLabel>در حال بارگذاری نقشه…</SkeletonLabel>
      <SkeletonBlock className="h-[70vh] w-full rounded-[var(--r-2xl)]" />
    </div>
  ),
});

export default function MapLoader(props: {
  initialDistricts: DistrictProperties[];
  initialCustomers: CustomerRow[];
  initialFacilities: FacilityRow[];
  initialLeads: Array<{ id: number; name: string; lat: number; lng: number }>;
  groups: MapGroup[];
  role: Role;
  geometryVersion: string;
}) {
  return (
    <WidgetBoundary label="نقشهٔ پوشش مشتریان">
      <CoverageMap {...props} />
    </WidgetBoundary>
  );
}
