"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** POSTs the prediction sweep, then refreshes the server component. */
export default function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch("/api/predict/refresh", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] text-[var(--text-muted)] disabled:opacity-50"
    >
      {busy ? "در حال محاسبه…" : "به‌روزرسانی پیش‌بینی"}
    </button>
  );
}
