"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import SwipeRow from "@/components/mobile/SwipeRow";
import { useRouter } from "next/navigation";
import AfterCallFlow from "@/components/crm/AfterCallFlow";
import OutcomeFlow from "@/components/flows/OutcomeFlow";
import { useHeldSave } from "@/components/crm/useHeldSave";
import { useToast } from "@/components/ToastProvider";
import { friendlyError } from "@/lib/userMessage";

interface ObjectionCard {
  title_fa: string;
  script_fa: string;
}

export default function TaskRow({ taskId, label, sub, customerId }: { taskId: number; label: string; sub?: string; customerId?: number }) {
  const router = useRouter();
  const toast = useToast();
  const { hold, cancel } = useHeldSave();
  const [card, setCard] = useState<ObjectionCard | null>(null);
  const [flow, setFlow] = useState<{ open: boolean } | null>(null);
  /* The outcome sheet for a task that is not about a customer's call. It remounts per opening
     (the key) so each recording starts on its question; `open` only slides it in and out. */
  const [outcome, setOutcome] = useState({ key: 0, open: false });
  /* Deleting hides the row at once and sends after the 5 s undo window, so «بازگردانی ثبت»
     is a local un-hide and there is no "are you sure?" tap in front of it. */
  const [gone, setGone] = useState(false);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { objection_card?: ObjectionCard | null; error?: string };
    return { res, j };
  }

  /** Marks the task done with the outcome. Runs after the undo window. */
  async function decide(code: string | null): Promise<{ ok: boolean; error?: string }> {
    const { res, j } = await patch(code ? { status: "done", outcome_code: code } : { status: "done" });
    if (!res.ok) return { ok: false, error: j.error };
    if (j.objection_card) {
      // Phase 8: show the coaching card in the call, then refresh the list.
      setCard(j.objection_card);
      window.setTimeout(() => router.refresh(), 6000);
    } else {
      router.refresh();
    }
    return { ok: true };
  }

  function remove() {
    setGone(true);
    hold(async () => {
      const { res, j } = await patch({ status: "dismissed" });
      if (!res.ok) {
        setGone(false);
        toast(friendlyError(j.error, "کار حذف نشد. دوباره تلاش کنید."), "error");
        return;
      }
      router.refresh();
    });
    toast(`«${label}» حذف شد`, "success", {
      label: "بازگردانی ثبت",
      icon: "undo",
      onClick: () => {
        if (cancel()) setGone(false);
      },
    });
  }

  if (gone) return null;

  const openOutcome = () => (customerId ? setFlow({ open: true }) : setOutcome((o) => ({ key: o.key + 1, open: true })));

  return (
    <li className="border-b border-[var(--border)]">
    <SwipeRow
      ownButtons={false}
      start={{ label: "ثبت نتیجه", icon: "check", run: openOutcome }}
      end={{ label: "حذف این کار", icon: "trash", tone: "bad", run: remove }}
    >
    <div className="flex flex-col gap-[var(--space-1)] py-[var(--space-2)]">
      <span className="text-[var(--text)]">
        {label}
        {sub && <span className="mr-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">· {sub}</span>}
      </span>
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {customerId ? (
          <button type="button" className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => setFlow({ open: true })}>
            <Icon name="check" size="md" />
            ثبت نتیجهٔ این کار
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn solid"
            onClick={() => setOutcome((o) => ({ key: o.key + 1, open: true }))}
          >
            <Icon name="check" size="md" />
            ثبت نتیجهٔ این کار
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-full px-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--text-faint)] hover:text-[var(--crit)]"
        >
          <Icon name="trash" size="sm" />
          حذف این کار
        </button>
      </div>
      {card && (
        <div className="mt-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--surface-2)] p-[var(--space-2)] text-[length:var(--text-xs)]">
          <strong className="text-[var(--text)]">{card.title_fa}</strong>
          <p className="m-0 mt-[var(--space-1)] leading-6 text-[var(--text-muted)]">{card.script_fa}</p>
        </div>
      )}
    </div>
    </SwipeRow>
    {/* The sheets sit outside the swipe face: events from a portal bubble through React's tree,
        and a drag inside a sheet must not move the row. */}
      {customerId && flow ? (
        <AfterCallFlow customerId={customerId} taskId={taskId} open={flow.open}
          onHide={() => setFlow({ open: false })}
          onReopen={() => setFlow({ open: true })}
          onFinished={() => { setFlow(null); router.refresh(); }} />
      ) : null}
      {outcome.key > 0 && (
        <OutcomeFlow
          key={outcome.key}
          open={outcome.open}
          taskLabel={label}
          decide={decide}
          onClose={() => setOutcome((o) => ({ ...o, open: false }))}
          onReopen={() => setOutcome((o) => ({ ...o, open: true }))}
        />
      )}
    </li>
  );
}
