"use client";

import { CoverageStatus, STATUS_COLOR, STATUS_LABEL, type DistrictColorMode } from "@/lib/types";
import CollapsibleSection from "@/components/CollapsibleSection";
import StatusPill from "@/components/StatusPill";
import { Icon } from "@/components/meridian/Icon";
import type { MapGroup } from "@/components/CoverageMap";

/** The sidebar's district colour legend, with the status / group switch. State stays in CoverageMap. */
export default function MapLegendSection({ groups, districtColorMode, setDistrictColorMode, shapedMarkers, bulkMode }: {
  groups: MapGroup[];
  districtColorMode: DistrictColorMode;
  setDistrictColorMode: (m: DistrictColorMode) => void;
  shapedMarkers: boolean;
  bulkMode: boolean;
}) {
  return (
        <CollapsibleSection title="راهنمای رنگ مناطق" icon="map" storageKey="legend" keywords="وضعیت پوشش رنگ گروه محدوده legend">
            {/* One meaning at a time. The fill cannot say both "needs coverage" and
                "belongs to گروه غرب" at once without an amber district being ambiguous,
                so the mode switches and the legend below switches with it. Hidden
                entirely when there are no groups yet -- a switch with one option is
                just clutter. */}
            {groups.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
                {(
                  [
                    ["status", "وضعیت پوشش"],
                    ["group", "گروه"],
                  ] as [DistrictColorMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setDistrictColorMode(mode)}
                    className={`rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                      districtColorMode === mode
                        ? "bg-accent font-medium text-accent-ink"
                        : "text-text-muted hover:bg-white/5 hover:text-text"
                    }`}
                  >
                    <Icon name="map-pin" size="sm" />
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {districtColorMode === "group" ? (
                <>
                  {groups.map((g) => (
                    <StatusPill
                      key={g.id}
                      color={g.color ?? STATUS_COLOR.unknown}
                      label={g.name}
                      shaped={shapedMarkers}
                    />
                  ))}
                  <StatusPill color={STATUS_COLOR.unknown} label="بدون گروه" shaped={shapedMarkers} />
                </>
              ) : (
                (Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
                  <StatusPill key={s} color={STATUS_COLOR[s]} label={STATUS_LABEL[s]} shaped={shapedMarkers} />
                ))
              )}
            </div>
            <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              {bulkMode
                ? "روی چند منطقه کلیک کنید تا انتخاب شوند، سپس از نوار پایین صفحه تغییر را روی همه اعمال کنید."
                : "برای تغییر وضعیت یک منطقه، روی آن در نقشه کلیک کنید."}
            </p>
        </CollapsibleSection>
  );
}
