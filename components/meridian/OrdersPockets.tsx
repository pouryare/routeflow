"use client";

import { useState } from "react";
import PocketCard, { type PocketDoc, type PocketStatus } from "./PocketCard";
import CustomerSheet from "./CustomerSheet";

export interface PocketRow {
  id: number;
  href: string;
  customerId: number;
  customer: string;
  meta: string;
  amount: string;
  status: PocketStatus;
  statusLabel: string;
  docs: PocketDoc[];
}

/** The orders grid, and the customer sheet it opens.
 *
 *  Tapping a pocket opens پنجرهٔ مشتری rather than jumping straight to the order, which is
 *  what the artifact does and is the more useful default: the question at this point is
 *  almost always "who is this and what do they buy", and the order itself is one tap
 *  further in from the sheet.
 */
export default function OrdersPockets({ rows }: { rows: PocketRow[] }) {
  const [open, setOpen] = useState<PocketRow | null>(null);

  return (
    <>
      <div className="pockets">
        {rows.map((r) => (
          <PocketCard
            key={r.id}
            customer={r.customer}
            meta={r.meta}
            amount={r.amount}
            status={r.status}
            statusLabel={r.statusLabel}
            docs={r.docs}
            onOpen={() => setOpen(r)}
          />
        ))}
      </div>
      <CustomerSheet
        customerId={open?.customerId ?? null}
        fallbackName={open?.customer}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
