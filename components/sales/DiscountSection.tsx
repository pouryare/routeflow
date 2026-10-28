"use client";

import { Icon } from "@/components/meridian/Icon";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import KeypadField from "@/components/mobile/KeypadField";
import { faNum, faToman } from "@/lib/format";
import { DISCOUNT_REASONS, type DiscountKind, type DiscountReason } from "@/lib/discounts";
import {
  LEDGER_LABEL,
  emptyDraft,
  payerKey,
  setShare,
  summarize,
  togglePayer,
  type DiscountDraft,
  type Payer,
} from "@/lib/discountDraft";

/** «تخفیف» on the order form: one tap opens it, then the amount (percent or toman, on the keypad), the
 *  reason as chips, and whose commission pays for it. Nobody chosen means the company absorbs it.
 *
 *  What it says at the bottom is the promise: the manager or owner has to approve before the order is
 *  confirmed, unless the owner is the one asking. The rules and arithmetic are in lib/discountDraft.ts. */
export default function DiscountSection({
  draft,
  onChange,
  total,
  payers,
  needsApproval,
}: {
  draft: DiscountDraft;
  onChange: (d: DiscountDraft) => void;
  /** What the order's lines come to before the discount. */
  total: number;
  payers: Payer[];
  /** False for the owner, whose own discount applies at once. */
  needsApproval: boolean;
}) {
  if (!draft.open) {
    return (
      <section className="card p-[var(--space-4)]">
        <button
          type="button"
          onClick={() => onChange({ ...draft, open: true })}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-strong)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)]"
        >
          <Icon name="plus" size="sm" />
          افزودن تخفیف
        </button>
      </section>
    );
  }

  const s = summarize(draft, total, payers);
  const picked = new Set(draft.payers.map((p) => p.key));
  const sharesShown = draft.payers.length > 1;

  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" aria-label="تخفیف">
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <h2 className="sechead__title m-0">تخفیف</h2>
        <button
          type="button"
          onClick={() => onChange(emptyDraft())}
          className="inline-flex min-h-[44px] items-center gap-[var(--space-1)] px-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
        >
          <Icon name="x" size="sm" />
          حذف تخفیف
        </button>
      </div>

      <ChipGroup
        group={{
          id: "discount-kind",
          label: "نوع تخفیف",
          mode: "single",
          neutral: "none",
          options: [{ id: "percent", label: "درصد" }, { id: "amount", label: "مبلغ" }],
          value: draft.kind,
          onChange: (v) => onChange({ ...draft, kind: (v === "amount" ? "amount" : "percent") as DiscountKind, value: "" }),
        }}
      />
      <KeypadField
        label={draft.kind === "percent" ? "درصد تخفیف" : "مبلغ تخفیف"}
        value={draft.value}
        onChange={(v) => onChange({ ...draft, value: v })}
        unit={draft.kind === "percent" ? "٪" : "تومان"}
        decimal={draft.kind === "percent"}
      />

      <ChipGroup
        wrap
        group={{
          id: "discount-reason",
          label: "دلیل تخفیف",
          mode: "single",
          options: DISCOUNT_REASONS.map((r) => ({ id: r.id, label: r.label })),
          value: draft.reason,
          onChange: (v) => onChange({ ...draft, reason: v as DiscountReason | "" }),
        }}
      />

      {payers.length > 0 && (
        <div className="flex flex-col gap-[var(--space-2)]">
          <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
            از پورسانت چه کسی کم شود؟ اگر کسی را انتخاب نکنید، شرکت تحمل می‌کند.
          </span>
          <ChipGroup
            wrap
            group={{
              id: "discount-payers",
              label: "کسر از پورسانت",
              mode: "multi",
              options: payers.map((p) => ({ id: payerKey(p), label: `${p.name} · ${LEDGER_LABEL[p.ledger]}` })),
              value: [...picked],
              onChange: (v) => {
                const next = new Set(v as string[]);
                // The group reports the whole new set; apply the one difference so shares re-split once.
                const added = [...next].find((k) => !picked.has(k));
                const removed = [...picked].find((k) => !next.has(k));
                const key = added ?? removed;
                if (key) onChange(togglePayer(draft, key));
              },
            }}
          />
        </div>
      )}

      {sharesShown && (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
          {draft.payers.map((p) => {
            const who = payers.find((x) => payerKey(x) === p.key);
            return (
              <li key={p.key} className="flex items-center justify-between gap-[var(--space-2)]">
                <span className="min-w-0 truncate text-[length:var(--text-sm)]">{who?.name ?? "—"}</span>
                <div className="w-[9rem] shrink-0">
                  <KeypadField label={`سهم ${who?.name ?? ""}`} value={p.share} onChange={(v) => onChange(setShare(draft, p.key, v))} unit="٪" decimal />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)] text-[length:var(--text-sm)]" role="status">
        {s.problem ? (
          <span className="text-[var(--text-muted)]">{s.problem}</span>
        ) : (
          <>
            <span className="tabular-nums">تخفیف {faToman(s.amount)} ({faNum(Math.round(s.percent * 100) / 100)}٪)</span>
            <span className="tabular-nums text-[var(--text-muted)]">مبلغ بعد از تخفیف {faToman(s.net)}</span>
          </>
        )}
        <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {needsApproval
            ? "سفارش تا تأیید مدیر یا مالک تأیید نهایی نمی‌شود."
            : "تخفیف شما به‌عنوان مالک بلافاصله اعمال می‌شود."}
        </span>
      </div>
    </section>
  );
}
