"use client";

import { CustomerColorMode, DISTANCE_BANDS } from "@/lib/types";
import CollapsibleSection from "@/components/CollapsibleSection";
import StatusPill from "@/components/StatusPill";
import { pickOrigin } from "@/lib/facilityTypes";
import { Icon } from "@/components/meridian/Icon";

/** The sidebar's «رنگ‌بندی مشتریان» section: which property colours the markers, plus the distance legend. */
export default function CustomerColourSection({ colorMode, setColorMode, colourOrigin, shapedMarkers }: {
  colorMode: CustomerColorMode;
  setColorMode: (m: CustomerColorMode) => void;
  colourOrigin: ReturnType<typeof pickOrigin>;
  shapedMarkers: boolean;
}) {
  return (
        <CollapsibleSection title="رنگ‌بندی مشتریان" icon="palette" storageKey="colour" keywords="وضعیت بدهی فروشنده رکود فاصله">
            {/* Five modes no longer fit a single row at sidebar width on a phone, so this
                is a grid rather than a flex row -- the fifth would otherwise squeeze the
                other four into unreadable slivers. */}
            <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
              {(
                [
                  ["status", "وضعیت"],
                  ["debt", "بدهی"],
                  ["phone_sales", "فروشنده"],
                  ["inactivity", "رکود"],
                  ["distance", "فاصله"],
                ] as [CustomerColorMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setColorMode(mode)}
                  disabled={mode === "distance" && !colourOrigin}
                  className={`rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] disabled:opacity-40 ${
                    colorMode === mode
                      ? "bg-accent font-medium text-accent-ink"
                      : "text-text-muted hover:bg-white/5 hover:text-text"
                  }`}
                >
                  <Icon name="map-pin" size="sm" />
                  {label}
                </button>
              ))}
            </div>

            {/* Without this the map is unreadable in distance mode -- the legend below
                explains district colours only, and the same three hues mean something
                entirely different on the markers. */}
            {colorMode === "distance" && colourOrigin && (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="font-mono text-[length:var(--text-xs)] leading-5 text-text-faint">
                  فاصله از {colourOrigin.name} — خط مستقیم
                </p>
                {DISTANCE_BANDS.map((band) => (
                  <StatusPill key={band.label} color={band.color} label={band.label} shaped={shapedMarkers} />
                ))}
              </div>
            )}
        </CollapsibleSection>
  );
}
