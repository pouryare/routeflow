"use client";

import { ChipGroup } from "@/components/mobile/FilterChips";
import { CustomerRow } from "@/lib/types";
import CollapsibleSection from "@/components/CollapsibleSection";
import { formatDistanceKm } from "@/lib/geo";
import { Icon } from "@/components/meridian/Icon";

/** The sidebar's «مشتریان نزدیک» list with its radius chips. State and handlers stay in CoverageMap.. */
export default function NearbyCustomersSection({ myPosition, nearbyCustomers, nearbyRadiusKm, setNearbyRadiusKm, flyToCustomer }: {
  myPosition: unknown;
  nearbyCustomers: { customer: CustomerRow; km: number }[];
  nearbyRadiusKm: number;
  setNearbyRadiusKm: (km: number) => void;
  flyToCustomer: (c: CustomerRow) => void;
}) {
  if (!(myPosition)) return null;
  return (
        <CollapsibleSection help="card.map-nearby"
          title="مشتریان نزدیک" icon="map-pin"
          count={nearbyCustomers.length}
          defaultOpen
          right={
            /* In the header rather than the body: changing the radius is how you
               decide whether this section is worth opening at all. */
            <ChipGroup
              group={{
                id: "nearby_radius",
                label: "شعاع جستجوی مشتریان نزدیک",
                mode: "single",
                neutral: "__none",
                value: String(nearbyRadiusKm),
                onChange: (v) => { if (v && v !== "__none") setNearbyRadiusKm(Number(v)); },
                options: [{ id: "1", label: "۱ کیلومتر" }, { id: "2", label: "۲ کیلومتر" }, { id: "5", label: "۵ کیلومتر" }],
              }}
            />
          }
        >
          {nearbyCustomers.length === 0 ? (
            <p className="text-[length:var(--text-xs)] text-text-faint">مشتری‌ای در این شعاع پیدا نشد.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {nearbyCustomers.map(({ customer, km }) => (
                <button
                  key={customer.id}
                  onClick={() => flyToCustomer(customer)}
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
                >
                  <Icon name="map-pin" size="md" />
                  <span className="truncate text-[length:var(--text-sm)] text-text">{customer.business_name}</span>
                  <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-accent">
                    {formatDistanceKm(km)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CollapsibleSection>
  );
}
