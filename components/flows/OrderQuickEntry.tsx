"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import OrderQuickFlow, { type QuickCustomer } from "./OrderQuickFlow";
import { autoOpenFlow, currentSearch } from "@/lib/flows/autoOpen";
import type { CatalogueProduct } from "@/lib/flows/orderQuick";

/** On a phone, the top of the new-order page offers «سفارش سریع» (repeat an order in a few taps)
 *  above the full form. The full form is untouched and one scroll away. */
export default function OrderQuickEntry({ customers, products, initialCustomerId }: {
  customers: QuickCustomer[];
  products: CatalogueProduct[];
  initialCustomerId: number | null;
}) {
  const [flow, setFlow] = useState(() => autoOpenFlow("quick", currentSearch()));
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium text-accent-ink"
      >
        <Icon name="repeat" size="md" />
        سفارش سریع (مثل سفارش قبلی)
      </button>
      {flow.key > 0 && (
        <OrderQuickFlow
          key={flow.key}
          open={flow.open}
          customers={customers}
          products={products}
          customerId={initialCustomerId}
          onFull={() => setFlow((f) => ({ ...f, open: false }))}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
