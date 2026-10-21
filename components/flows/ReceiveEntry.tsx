"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import ReceiveFlow, { type ReceiveProduct } from "./ReceiveFlow";

/** «دریافت کالا» on the stock page (owner): a delivery at the door in a few taps. The invoice
 *  form with its line table stays below for a whole supplier invoice. */
export default function ReceiveEntry({ products, suppliers }: { products: ReceiveProduct[]; suppliers: string[] }) {
  const [flow, setFlow] = useState({ key: 0, open: false });
  return (
    <>
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)]"
      >
        <Icon name="truck" size="md" />
        دریافت کالا
      </button>
      {flow.key > 0 && (
        <ReceiveFlow
          key={flow.key}
          open={flow.open}
          products={products}
          suppliers={suppliers}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </>
  );
}
