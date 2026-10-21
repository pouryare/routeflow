"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { expenseChips, expenseFlow, expenseRequest } from "@/lib/flows/expense";
import { tehranTodayIso } from "@/lib/jalali";

export interface ExpenseCategory {
  id: number;
  nameFa: string;
}

const FAILURE = "هزینه ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** An expense, as a tap flow. Mount it with a fresh `key` each time it opens. */
export default function ExpenseFlow({
  open,
  categories,
  suppliers,
  onClose,
  onReopen,
}: {
  open: boolean;
  categories: ExpenseCategory[];
  /** Recent supplier names, offered as answers. */
  suppliers: string[];
  onClose: () => void;
  onReopen?: () => void;
}) {
  const router = useRouter();
  const today = useMemo(() => tehranTodayIso(), []);
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "expense",
      lists: {
        category: categories.map((c) => ({ id: c.id, label: c.nameFa })),
        supplier: suppliers.map((s, i) => ({ id: i + 1, label: s })),
      },
      vars: { today },
    }),
    [categories, suppliers, today],
  );

  const { state, setState, onSaved } = useFlowHost(expenseFlow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/accounting/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expenseRequest(ctx, st)),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `هزینه ثبت شد · ${expenseChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: () => router.refresh(),
    onReopen,
  });

  return (
    <TapFlow
      open={open}
      title="ثبت هزینه"
      config={expenseFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      done={<FlowDone key={state.answers.length} chips={expenseChips(ctx, state)} onReturn={onClose} />}
    />
  );
}
