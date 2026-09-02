"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const OUTCOMES: { code: string; label: string }[] = [
  { code: "CONTACTED", label: "تماس شد" },
  { code: "ORDERED", label: "خرید کرد" },
  { code: "PRICE_OBJECTION", label: "قیمت" },
  { code: "NOT_INTERESTED", label: "رد کرد" },
];

export default function TaskRow({ taskId, label, sub }: { taskId: number; label: string; sub?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolve(code: string | null) {
    setBusy(true);
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(code ? { status: "done", outcome_code: code } : { status: "dismissed" }),
      });
      router.refresh();
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
        {OUTCOMES.map((o) => (
          <button
            key={o.code}
            type="button"
            disabled={busy}
            onClick={() => void resolve(o.code)}
            className="rounded-full border border-[var(--border)] px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve(null)}
          className="rounded-full px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] text-[var(--text-faint)] hover:text-[var(--crit)] disabled:opacity-50"
        >
          حذف
        </button>
      </div>
    </li>
  );
}
