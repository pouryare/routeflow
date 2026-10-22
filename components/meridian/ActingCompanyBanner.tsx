"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";

/** Shown on every shell page while the platform owner is acting in ONE company.
 *
 *  In that state every read and every write is that company's (the session behaves as its owner),
 *  so forgetting which company you are in is the mistake to prevent: a customer added, a price
 *  changed or a staff member deactivated in the wrong place. It cannot be dismissed; «همهٔ سازمان‌ها»
 *  goes back through POST /api/admin/acting-org and refreshes, so every server component re-reads
 *  the session. Reuses the Login-As banner's look (`actas`). */
export default function ActingCompanyBanner({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function all() {
    setBusy(true);
    await fetch("/api/admin/acting-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: null }),
    }).catch(() => null);
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="actas" role="status">
      <Icon name="building" size="sm" />
      <span className="actas__text">
        در حال کار در سازمان <b>{name}</b> به‌عنوان مالک آن. هر تغییری که اینجا انجام دهید در همین سازمان ثبت می‌شود.
      </span>
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => void all()} disabled={busy}>
        <Icon name="building" size="md" />
        {busy ? "در حال بازگشت…" : "همهٔ سازمان‌ها"}
      </button>
    </div>
  );
}
