"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import ExpenseFlow, { type ExpenseCategory } from "./ExpenseFlow";

/** «ثبت هزینه» on the expenses page: rent, fuel, a repair, in a few taps. */
export default function ExpenseEntry({ categories, suppliers }: { categories: ExpenseCategory[]; suppliers: string[] }) {
  const [flow, setFlow] = useState({ key: 0, open: false });
  return (
    <>
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)]"
      >
        <Icon name="plus" size="md" />
        ثبت هزینه
      </button>
      {flow.key > 0 && (
        <ExpenseFlow
          key={flow.key}
          open={flow.open}
          categories={categories}
          suppliers={suppliers}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </>
  );
}
