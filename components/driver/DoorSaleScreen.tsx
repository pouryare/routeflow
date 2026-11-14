"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import StickyAction from "@/components/mobile/StickyAction";
import DoorSaleFlow, { type DoorCustomer } from "@/components/flows/DoorSaleFlow";
import { autoOpenFlow, currentSearch } from "@/lib/flows/autoOpen";
import type { FlowItem } from "@/lib/flows/item";
import { faNum, faToman } from "@/lib/format";

const onlineStore = {
  subscribe: (cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  },
  get: () => navigator.onLine,
};

/** VC4: the page a van role opens at a customer's door. What the van holds, what today already holds, and one
 *  big button that opens the sale-or-sample flow. A link with `?sale=1&customer=ID` opens the flow at once. */
export default function DoorSaleScreen({ customers, items, today, presetCustomerId }: {
  customers: DoorCustomer[];
  items: (FlowItem & { packs_on_van: number })[];
  today: { sales: number; sold_toman: number; samples: number };
  presetCustomerId: number | null;
}) {
  const router = useRouter();
  const online = useSyncExternalStore(onlineStore.subscribe, onlineStore.get, () => true);
  // `?sale=1` opens the flow on arrival (the same way the other entry pages do).
  const [flow, setFlow] = useState(() => autoOpenFlow("sale", currentSearch()));

  return (
    <div className="flex flex-col gap-[var(--space-4)] sticky-action-gap" dir="rtl">
      {!online && (
        <p role="status" className="m-0 flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--warning)] p-[var(--space-3)] text-[length:var(--text-sm)]">
          <Icon name="warn" size="md" /> اینترنت قطع است. فروش و نمونه با اینترنت ثبت می‌شود؛ تا وصل شدن، روی کاغذ بنویسید.
        </p>
      )}
      <section aria-label="امروز" className="grid grid-cols-2 gap-[var(--space-3)]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-3)]">
          <div className="text-[length:var(--text-xs)] text-[var(--muted)]">فروش امروز</div>
          <div className="tabular-nums text-[length:var(--text-md)] font-medium">{faToman(today.sold_toman)}</div>
          <div className="text-[length:var(--text-xs)] text-[var(--text-faint)]">{faNum(today.sales)} فروش</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-3)]">
          <div className="text-[length:var(--text-xs)] text-[var(--muted)]">نمونهٔ امروز</div>
          <div className="tabular-nums text-[length:var(--text-md)] font-medium">{faNum(today.samples)}</div>
          <div className="text-[length:var(--text-xs)] text-[var(--text-faint)]">رایگان</div>
        </div>
      </section>

      <section aria-labelledby="on-van">
        <SectionHead id="on-van" title="روی ماشین شما" />
        {items.length === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">ماشین خالی است. مدیر باید کالا را از انبار بارگیری کند؛ بعد از آن اینجا می‌آید.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] py-[var(--space-2)]">
                <span>{i.label}</span>
                <span className="tabular-nums text-[var(--muted)]">
                  {faNum(i.packs_on_van)} بسته{i.price === undefined ? " · بدون قیمت" : ` · ${faToman(i.price)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {flow.key > 0 && (
        <DoorSaleFlow
          key={flow.key}
          open={flow.open}
          customers={customers}
          items={items}
          customerId={presetCustomerId}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
          onRecorded={() => router.refresh()}
          onAnother={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        />
      )}
      <span data-tour="door-sale:open">
        <StickyAction
          label="ثبت فروش یا نمونه"
          icon="handshake"
          disabled={items.length === 0 || !online}
          onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        />
      </span>
    </div>
  );
}
