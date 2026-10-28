"use client";

import { CustomerRow } from "@/lib/types";
import CollapsibleSection from "@/components/CollapsibleSection";
import { Icon } from "@/components/meridian/Icon";

/** The sidebar's «اخیراً دیده‌شده» list.. */
export default function RecentCustomersSection({ recentCustomers, flyToCustomer, togglePinned }: {
  recentCustomers: CustomerRow[];
  flyToCustomer: (c: CustomerRow) => void;
  togglePinned: (id: number) => void;
}) {
  if (!(recentCustomers.length > 0)) return null;
  return (
        <CollapsibleSection help="card.map-recent" title="اخیراً دیده‌شده" icon="clock" count={recentCustomers.length} storageKey="recent">
          <div className="flex flex-col gap-1.5">
            {recentCustomers.map((c) => (
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
                  aria-label={`سنجاق کردن ${c.business_name}`}
                  title="سنجاق کردن"
                  className="shrink-0 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
                >
                  <Icon name="pin" size="sm" />
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
  );
}
