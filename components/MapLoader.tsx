"use client";

import dynamic from "next/dynamic";

const CoverageMap = dynamic(() => import("@/components/CoverageMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center">
      <p className="text-sm opacity-60">در حال بارگذاری نقشه…</p>
    </div>
  ),
});

export default function MapLoader() {
  return <CoverageMap />;
}
