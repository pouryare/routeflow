"use client";

import CollapsibleSection from "@/components/CollapsibleSection";
import { distanceKm, formatDistanceKm } from "@/lib/geo";
import { useCorridor } from "@/components/coverage/useCorridor";
import { LayerHint } from "@/components/LayersPanel";
import { isPlaced, FacilityRow } from "@/lib/facilityTypes";
import { facilityMarkerHtml } from "@/components/facilityArt";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";

// Three presets rather than a slider: this gets used one-handed in a moving vehicle,
// where a slider thumb is unusable.
export const CORRIDOR_WIDTHS = [2, 5, 10];

/** The sidebar's «تأسیسات ما» section: our depots, and the corridor between them. State stays in CoverageMap. */
export default function MapSitesSection({ initialFacilities, placedFacilities, flyToFacility, corridorEnds, corridorOn, corridorWidthKm, setCorridorWidthKm, corridorRoute, corridorRouting, corridorUncovered, setLayersOpen }: {
  initialFacilities: FacilityRow[];
  placedFacilities: (FacilityRow & { lat: number; lng: number })[];
  flyToFacility: (f: FacilityRow & { lat: number; lng: number }) => void;
  corridorEnds: ReturnType<typeof useCorridor>["ends"];
  corridorOn: boolean;
  corridorWidthKm: number;
  setCorridorWidthKm: (km: number) => void;
  corridorRoute: ReturnType<typeof useCorridor>["route"];
  corridorRouting: boolean;
  corridorUncovered: number;
  setLayersOpen: (open: boolean) => void;
}) {
  return (
        <CollapsibleSection help="card.map-sites" title="تأسیسات ما" icon="building" storageKey="sites" keywords="انبار مبدأ خانه کریدور depot">
            <div className="flex flex-col gap-1">
              {initialFacilities.map((f) => (
                <button
                  key={f.id}
                  onClick={() => isPlaced(f) && flyToFacility(f)}
                  className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                >
                  <Icon name="map-pin" size="md" />
                  <span
                    className="shrink-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: facilityMarkerHtml(f.icon_key, f.kind),
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[length:var(--text-sm)] text-text">{f.name}</span>
                    {f.notes && (
                      <span className="block truncate text-[length:var(--text-xs)] text-text-faint">{f.notes}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            {placedFacilities.length === 2 && (
              <p className="mt-2 font-mono text-[length:var(--text-xs)] leading-5 text-text-faint">
                {formatDistanceKm(distanceKm(placedFacilities[0], placedFacilities[1]))} فاصله مستقیم بین دو انبار
              </p>
            )}

            {/* Feature 3. Lives under the sites section because the corridor is a property
                of the sites, not a separate map layer the user has to connect back to them. */}
            {corridorEnds && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[length:var(--text-sm)] text-text">کریدور بین انبارها</span>
                  {!corridorOn && <LayerHint onOpen={() => setLayersOpen(true)} what="کریدور" compact />}
                </div>

                {corridorOn && (
                  <>
                    <div className="mt-2 flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
                      {CORRIDOR_WIDTHS.map((km) => (
                        <button
                          key={km}
                          onClick={() => {
                            setCorridorWidthKm(km);
                            localStorage.setItem("coverage_corridor_km", String(km));
                          }}
                          className={`flex-1 rounded-[var(--radius-sm)] px-0.5 py-1.5 font-mono text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                            corridorWidthKm === km
                              ? "bg-accent font-medium text-accent-ink"
                              : "text-text-muted hover:bg-white/5 hover:text-text"
                          }`}
                        >
                          <Icon name="route" size="sm" />
                          {km} کیلومتر
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
                      <span>
                        مسیر {corridorEnds.a.name} تا {corridorEnds.b.name} (
                        {formatDistanceKm(corridorRoute ? corridorRoute.km : corridorEnds.km)}
                        {corridorRoute ? "، روی جاده" : corridorRouting ? "، در حال مسیریابی…" : "، خط مستقیم"}
                        ).
                      </span>{" "}
                      <span>
                        {corridorUncovered > 0
                          ? `${faNum(corridorUncovered)} منطقه نیازمند پوشش سر این راه است.`
                          : "این مسیر از هیچ منطقهٔ بدون پوشش نمی‌گذرد."}
                      </span>
                      {!corridorRoute && !corridorRouting && (
                        <span className="mt-1 block text-warn">
                          مسیریاب در دسترس نبود — نوار روی خط مستقیم بین دو نقطه کشیده شده، نه روی جاده.
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>
            )}
        </CollapsibleSection>
  );
}
