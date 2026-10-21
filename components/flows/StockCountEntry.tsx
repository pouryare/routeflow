"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import StockCountFlow, { type CountRow } from "./StockCountFlow";

/** «شمارش انبار» on the stock page: walks the shelf product by product. */
export default function StockCountEntry({ rows, facility }: { rows: CountRow[]; facility: { id: number; name: string } }) {
  const [flow, setFlow] = useState({ key: 0, open: false });
  return (
    <>
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-accent-ink"
      >
        <Icon name="package" size="md" />
        شمارش انبار
      </button>
      {flow.key > 0 && (
        <StockCountFlow
          key={flow.key}
          open={flow.open}
          rows={rows}
          facility={facility}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
        />
      )}
    </>
  );
}
