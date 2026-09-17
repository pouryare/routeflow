"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import OutcomeChips from "./OutcomeChips";
import AfterCallFlow from "@/components/crm/AfterCallFlow";

interface ObjectionCard {
  title_fa: string;
  script_fa: string;
}

export default function TaskRow({ taskId, label, sub, customerId }: { taskId: number; label: string; sub?: string; customerId?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<ObjectionCard | null>(null);
  const [flow, setFlow] = useState<{ open: boolean } | null>(null);

  async function resolve(code: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(code ? { status: "done", outcome_code: code } : { status: "dismissed" }),
      });
      const j = (await res.json().catch(() => ({}))) as { objection_card?: ObjectionCard | null };
      if (j.objection_card) {
        // Phase 8: show the coaching card in the call, then refresh the list.
        setCard(j.objection_card);
        window.setTimeout(() => router.refresh(), 6000);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] py-[var(--space-2)]">
      <span className="text-[var(--text)]">
        {label}
        {sub && <span className="mr-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">· {sub}</span>}
      </span>
      <div className="flex flex-wrap gap-[var(--space-1)]">
        {customerId ? (
          <button type="button" className="btn solid" onClick={() => setFlow({ open: true })}>ثبت نتیجه</button>
        ) : (
          <OutcomeChips disabled={busy} onPick={(code) => void resolve(code)} />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve(null)}
          className="rounded-full px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] text-[var(--text-faint)] hover:text-[var(--crit)] disabled:opacity-50"
        >
          حذف
        </button>
      </div>
      {card && (
        <div className="mt-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--surface-2)] p-[var(--space-2)] text-[length:var(--text-xs)]">
          <strong className="text-[var(--text)]">{card.title_fa}</strong>
          <p className="m-0 mt-[var(--space-1)] leading-6 text-[var(--text-muted)]">{card.script_fa}</p>
        </div>
      )}
      {customerId && flow ? (
        <AfterCallFlow customerId={customerId} taskId={taskId} open={flow.open}
          onHide={() => setFlow({ open: false })}
          onReopen={() => setFlow({ open: true })}
          onFinished={() => { setFlow(null); router.refresh(); }} />
      ) : null}
    </li>
  );
}
