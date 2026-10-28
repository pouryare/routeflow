"use client";

import { Button } from "@heroui/react";
import { FileTrigger } from "react-aria-components";
import { SkipButton } from "@/components/tapflow/Answer";
import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import { Icon } from "@/components/meridian/Icon";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { expenseChips, expenseFlow, expenseRequest, hasPhoto } from "@/lib/flows/expense";
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

  /* The receipt picture lives here, not in the flow state: a File is not an answer. It is taken on
     the photo step and sent to the new expense once the expense itself is saved. */
  const receipt = useRef<File | null>(null);
  const { state, setState, onSaved } = useFlowHost(expenseFlow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/accounting/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expenseRequest(ctx, st)),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: number };
      if (!res.ok) return { ok: false, error: json.error };
      const file = hasPhoto(st) ? receipt.current : null;
      if (file && typeof json.id === "number") {
        // The expense is saved either way; a failed picture is reported but does not undo it.
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(`/api/accounting/expenses/${json.id}/receipt`, { method: "POST", body: form }).catch(() => null);
        if (!up || !up.ok) return { ok: false, error: "هزینه ثبت شد ولی عکس رسید ارسال نشد؛ از صفحهٔ دفتر دوباره بفرستید." };
      }
      return { ok: true };
    },
    summary: (st) => `هزینه ثبت شد · ${expenseChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: () => router.refresh(),
    onReopen,
  });

  const renderCustom = (api: CustomStepApi) =>
    api.step.kind === "photo" ? (
      <div className="tf-grid one">
        {/* The camera on a phone (capture), the file picker on a desk. The pick itself is the answer. */}
        <FileTrigger
          acceptedFileTypes={["image/*"]}
          defaultCamera="environment"
          onSelect={(files) => {
            const f = files?.[0];
            if (!f) return;
            receipt.current = f;
            api.submit("take");
          }}
        >
          <Button variant="secondary" className="tf-opt rec">
            <Icon name="camera" size="md" />
            عکس رسید
          </Button>
        </FileTrigger>
        <SkipButton icon="arrow-left" onPress={() => api.submit("none")}>بدون عکس</SkipButton>
      </div>
    ) : null;

  return (
    <TapFlow
      open={open}
      title="ثبت هزینه"
      renderCustom={renderCustom}
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
