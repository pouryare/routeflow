"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import DecisionDeck from "@/components/mobile/DecisionDeck";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { DISCOUNT_CHOICES, DISCOUNT_CONSEQUENCE, discountRequest } from "@/lib/decisions";
import { DISCOUNT_REASONS } from "@/lib/discounts";
import { faNum, faToman } from "@/lib/format";
import type { PendingDiscountCard } from "@/lib/repo/discounts";

const reasonLabel = (id: string) => DISCOUNT_REASONS.find((r) => r.id === id)?.label ?? id;

/** «تأیید تخفیف» for a group manager or the owner: every discount waiting for them as one card,
 *  approve or reject with the 5 s undo. The list is the page's snapshot at open time. */
export default function DiscountDeckEntry({ approvals }: { approvals: PendingDiscountCard[] }) {
  const router = useRouter();
  const undoable = useUndoableAction();
  const [deck, setDeck] = useState({ key: 0, open: false });
  if (approvals.length === 0) return null;

  const decide = (a: PendingDiscountCard, verdict: string) =>
    undoable.run({
      message: `سفارش ${a.order_no} · ${verdict === "approved" ? "تخفیف تأیید شد" : "تخفیف رد شد"}`,
      send: async () => {
        const res = await fetch(`/api/sales/discounts/${a.id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(discountRequest(verdict)),
        });
        return res.ok ? { ok: true } : { ok: false, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error };
      },
      failure: "تصمیم ثبت نشد؛ دوباره تلاش کنید",
      onDone: () => router.refresh(),
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setDeck((d) => ({ key: d.key + 1, open: true }))}
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--crit)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)]"
      >
        <Icon name="check" size="md" />
        {`تأیید تخفیف · ${faNum(approvals.length)} مورد منتظر شما`}
      </button>
      {deck.key > 0 && (
        <DecisionDeck
          key={deck.key}
          open={deck.open}
          title="درخواست‌های تخفیف"
          items={approvals}
          keyOf={(a) => a.id}
          choices={DISCOUNT_CHOICES}
          onDecide={decide}
          onClose={() => setDeck((d) => ({ ...d, open: false }))}
          render={(a) => (
            <>
              <strong>{a.customer_name}</strong>
              <span>سفارش {a.order_no} · از {a.requested_by_name}</span>
              <span>{faToman(a.amount_toman)} تخفیف ({faNum(Math.round(a.percent * 10) / 10)}٪ از {faToman(a.gross_toman)})</span>
              <span>دلیل: {reasonLabel(a.reason)}{a.note ? ` · ${a.note}` : ""}</span>
              <span>
                {a.shares.length === 0
                  ? "از کمیسیون کسی کم نمی‌شود؛ شرکت می‌پذیرد"
                  : `از کمیسیون: ${a.shares.map((s) => `${s.display_name} ${faNum(s.share_pct)}٪`).join("، ")}`}
              </span>
              <span className="text-text-muted">تأیید: {DISCOUNT_CONSEQUENCE.approved} رد: {DISCOUNT_CONSEQUENCE.rejected}</span>
            </>
          )}
        />
      )}
    </>
  );
}
