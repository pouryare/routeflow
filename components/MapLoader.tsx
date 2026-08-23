"use client";

import dynamic from "next/dynamic";
import { CustomerRow, DistrictProperties } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";

const CoverageMap = dynamic(() => import("@/components/CoverageMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-bg">
      <p className="text-sm opacity-60">در حال بارگذاری نقشه…</p>
    </div>
  ),
});

export default function MapLoader(props: {
  initialDistricts: DistrictProperties[];
  initialCustomers: CustomerRow[];
  initialFacilities: FacilityRow[];
  geometryVersion: string;
}) {
  return <CoverageMap {...props} />;
}
