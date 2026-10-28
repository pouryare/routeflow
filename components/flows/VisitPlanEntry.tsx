"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import VisitPlanFlow, { type PlanCustomer, type PlanLead } from "./VisitPlanFlow";

/** «افزودن به برنامه» on the planner, phone only: the search box below needs the keyboard, this
 *  needs two taps. */
export default function VisitPlanEntry(props: {
  customers: PlanCustomer[];
  leads: PlanLead[];
  selectedDate: string;
  onAdded: () => void;
}) {
  const [flow, setFlow] = useState({ key: 0, open: false });
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-accent px-4 text-[length:var(--text-sm)] font-medium text-accent-ink"
      >
        <Icon name="calendar-plus" size="md" />
        افزودن به برنامه
      </button>
      {flow.key > 0 && (
        <VisitPlanFlow
          key={flow.key}
          open={flow.open}
          {...props}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
