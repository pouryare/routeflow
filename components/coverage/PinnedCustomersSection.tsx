"use client";

import { CustomerRow } from "@/lib/types";
import CollapsibleSection from "@/components/CollapsibleSection";
import { Icon } from "@/components/meridian/Icon";

/** The sidebar's «سنجاق‌شده» list.. */
export default function PinnedCustomersSection({ pinnedCustomers, flyToCustomer, togglePinned }: {
  pinnedCustomers: CustomerRow[];
  flyToCustomer: (c: CustomerRow) => void;
  togglePinned: (id: number) => void;
}) {
  if (!(pinnedCustomers.length > 0)) return null;
  return (
        <CollapsibleSection help="card.map-pinned" title="سنجاق‌شده" icon="star" count={pinnedCustomers.length} storageKey="pinned" defaultOpen>
          <div className="flex flex-col gap-1.5">
            {pinnedCustomers.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-2"
              >
                <button
                  onClick={() => flyToCustomer(c)}
                  className="min-w-0 flex-1 truncate text-right text-[length:var(--text-sm)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
                >
                  <Icon name="map-pin" size="sm" />
                  {c.business_name}
                </button>
                <button
                  onClick={() => togglePinned(c.id)}
                  aria-label={`برداشتن سنجاق ${c.business_name}`}
                  title="برداشتن سنجاق"
                  className="shrink-0 text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-crit"
                >
                  <Icon name="star" size="sm" />
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
  );
}
