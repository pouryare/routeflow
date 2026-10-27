"use client";

import { useState } from "react";
import BusyIcon from "@/components/meridian/BusyIcon";
import { useRouter } from "next/navigation";

/** POSTs a sweep endpoint (rules / analysis / prediction refresh), then re-renders the
 *  server component so the fresh rows show. The endpoints also run on a timer
 *  (routeflow-sweep-*.timer); this is the "I need it now" path. */
export default function SweepButton({
  endpoint,
  idleLabel,
  busyLabel = "در حال محاسبه…",
}: {
  endpoint: string;
  idleLabel: string;
  busyLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch(endpoint, { method: "POST" });
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
      className="inline-flex items-center justify-center gap-[var(--space-2)] cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[2px] touch text-[length:var(--text-xs)] text-[var(--text-muted)] disabled:opacity-50"
    >
      <BusyIcon busy={busy} name="sparkle" size="sm" />
      {busy ? busyLabel : idleLabel}
    </button>
  );
}
