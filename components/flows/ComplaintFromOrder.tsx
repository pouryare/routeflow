"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import ComplaintFlow, { type ComplaintProduct } from "./ComplaintFlow";

/** «ثبت شکایت» on an order's page: the customer and the order are known, so the flow asks only
 *  which of this order's products and what is wrong. */
export default function ComplaintFromOrder({ orderId, customerId, customerName, products }: {
  orderId: number;
  customerId: number;
  customerName: string;
  products: ComplaintProduct[];
}) {
  const router = useRouter();
  const [flow, setFlow] = useState({ key: 0, open: false });
  return (
    <>
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text)]"
      >
        <Icon name="warn" size="md" />
        ثبت شکایت برای این سفارش
      </button>
      {flow.key > 0 && (
        <ComplaintFlow
          key={flow.key}
          open={flow.open}
          customers={[{ id: customerId, business_name: customerName }]}
          products={products}
          customerId={customerId}
          orderId={orderId}
          onRecorded={() => router.refresh()}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </>
  );
}
