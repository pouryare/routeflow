"use client";

/** The four sales-call outcome pills — shared by the /today briefing row and the Board's
 *  "drop into انجام‌شده" flow so the wording and the codes live in one place. Each
 *  consumer adds its own trailing action (dismiss on /today, "بدون نتیجه" on the Board). */
export const OUTCOMES: { code: string; label: string }[] = [
  { code: "CONTACTED", label: "تماس شد" },
  { code: "ORDERED", label: "خرید کرد" },
  { code: "PRICE_OBJECTION", label: "قیمت" },
  { code: "NOT_INTERESTED", label: "رد کرد" },
];

export default function OutcomeChips({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (code: string) => void;
}) {
  return (
    <>
      {OUTCOMES.map((o) => (
        <button
          key={o.code}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.code)}
          className="rounded-full border border-[var(--border)] px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          {o.label}
        </button>
      ))}
    </>
  );
}
