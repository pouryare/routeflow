"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import DecisionDeck from "@/components/mobile/DecisionDeck";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { CREDIT_CHOICES, CREDIT_CONSEQUENCE, creditRequest } from "@/lib/decisions";
import { faNum, faToman } from "@/lib/format";
import { RISK_LEVEL_LABEL } from "@/lib/creditRisk";
import type { PendingApprovalCard } from "@/lib/repo/creditApprovals";

/** «تأیید اعتبار» for a manager: every order parked over a customer's limit as one card, approve or
 *  reject with the 5 s undo. The list is the page's snapshot at open time. */
export default function CreditDeckEntry({ approvals }: { approvals: PendingApprovalCard[] }) {
  const router = useRouter();
  const undoable = useUndoableAction();
  const [deck, setDeck] = useState({ key: 0, open: false });
  if (approvals.length === 0) return null;

  const decide = (a: PendingApprovalCard, verdict: string) =>
    undoable.run({
      message: `سفارش ${a.order_no} · ${verdict === "approved" ? (a.two_step && !a.manager_ok ? "تأیید شما ثبت شد؛ اگر لازم باشد مالک ادامه می‌دهد" : "اعتبار تأیید شد") : "درخواست رد شد"}`,
      send: async () => {
        const res = await fetch(`/api/sales/credit-approvals/${a.id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creditRequest(verdict)),
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
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--foreground)]"
      >
        <Icon name="check" size="md" />
        {`تأیید اعتبار · ${faNum(approvals.length)} مورد منتظر شما`}
      </button>
      {deck.key > 0 && (
        <DecisionDeck
          key={deck.key}
          open={deck.open}
          title="درخواست‌های اعتبار"
          items={approvals}
          keyOf={(a) => a.id}
          choices={CREDIT_CHOICES}
          onDecide={decide}
          onClose={() => setDeck((d) => ({ ...d, open: false }))}
          render={(a) => (
            <>
              <strong>{a.customer_name}</strong>
              <span>سفارش {a.order_no}</span>
              {a.two_step ? <span style={{ color: "var(--warning)" }}>{a.manager_ok ? "مدیر گروه تأیید کرده؛ نوبت مالک" : "مبلغ بزرگ است: پس از تأیید شما مالک هم باید تأیید کند"}</span> : null}
              {a.kind === "hold" ? (
                <span>مشتری نگه داشته شده است · جمع سفارش {faToman(a.customer_balance_toman)} · دلیل را در صفحهٔ مشتری ببینید</span>
              ) : a.kind === "value" ? (
                <span>جمع سفارش {faToman(a.customer_balance_toman)} · سقف سفارش بدون تأیید {faToman(a.credit_limit_toman ?? 0)}</span>
              ) : (
                <>
                  <span>بدهی فعلی {faToman(a.customer_balance_toman)}</span>
                  <span>{a.credit_limit_toman === null ? "سقف اعتبار ندارد" : `سقف ${faToman(a.credit_limit_toman)}`} · {faToman(a.overage_toman)} بیش از سقف</span>
                </>
              )}
              {a.risk ? <span>ریسک اعتبار: {RISK_LEVEL_LABEL[a.risk.level]}{a.risk.reasons.length ? ` · ${a.risk.reasons.join("، ")}` : ""}</span> : null}
              <span className="text-text-muted">تأیید: {CREDIT_CONSEQUENCE.approved} رد: {CREDIT_CONSEQUENCE.rejected}</span>
            </>
          )}
        />
      )}
    </>
  );
}
