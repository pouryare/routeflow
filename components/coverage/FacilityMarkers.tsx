"use client";

import Link from "next/link";
import { Marker, Popup } from "react-leaflet";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import { formatDistanceKm } from "@/lib/geo";
import { FACILITY_LABEL, FacilityRow } from "@/lib/facilityTypes";
import { facilityIcon } from "@/components/facilityIcon";
import { coordText } from "@/lib/clipboard";
import CopyButton from "@/components/CopyButton";
import { Icon } from "@/components/meridian/Icon";
import { otherFacilityDistance } from "@/components/coverage/mapParts";

/** One pin per placed depot, lifted above the customer cluster: landmarks the rest of the map is read against. */
export default function FacilityMarkers({ placedFacilities, navAppId }: {
  placedFacilities: (FacilityRow & { lat: number; lng: number })[];
  navAppId: ReturnType<typeof useNavApp>[0];
}) {
  return (
    <>
          {placedFacilities.map((f) => {
            const rel = otherFacilityDistance(f, placedFacilities);
            return (
              <Marker
                key={f.id}
                position={[f.lat, f.lng]}
                title={f.name}
                icon={facilityIcon(f.kind, f.icon_key)}
                zIndexOffset={1000}
              >
                <Popup>
                  <div dir="rtl" className="text-[length:var(--text-sm)] leading-6">
                    <p className="font-medium text-text">{f.name}</p>
                    <p className="mt-0.5 text-[length:var(--text-xs)] text-text-muted">
                      {FACILITY_LABEL[f.kind]}
                    </p>
                    {f.address && (
                      <p className="mt-1.5 text-[length:var(--text-xs)] text-text-muted">{f.address}</p>
                    )}
                    <p className="mt-1.5 flex items-center gap-2 text-right font-mono text-[length:var(--text-xs)] text-text-faint">
                      <span dir="ltr">{coordText(f.lat, f.lng)}</span>
                      <CopyButton value={coordText(f.lat, f.lng)} what="کپی مختصات" />
                    </p>
                    {rel && (
                      <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
                        {formatDistanceKm(rel.km)} تا {rel.other.name} (خط مستقیم)
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <a
                        href={navigateUrl(navAppId, { lat: f.lat, lng: f.lng }, f.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[length:var(--text-xs)] text-accent hover:underline"
                      >
                        مسیریابی <Icon name="external-link" size="sm" />
                      </a>
                      <Link
                        href={`/facilities?f=${f.id}`}
                        className="text-[length:var(--text-xs)] text-accent hover:underline"
                      >
                        ویرایش این مکان ←
                      </Link>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
    </>
  );
}
