"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";

/** Shown on every shell page while an owner is seeing the app as someone else (Login-As).
 *
 *  It cannot be dismissed: forgetting you are signed in as a salesperson, and then acting
 *  on their behalf, is exactly the mistake it exists to prevent. «بازگشت» ends the
 *  impersonation through DELETE /api/admin/impersonate and refreshes, so every server
 *  component re-reads the owner's own session. */
export default function ImpersonationBanner({ asName, asRole }: { asName: string; asRole: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function back() {
    setBusy(true);
    await fetch("/api/admin/impersonate", { method: "DELETE" }).catch(() => null);
    /* refresh() re-runs every server component against the restored cookie, so the
       header, the tabs and the data are the owner's again, not just the URL. */
    router.push("/sales");
    router.refresh();
  }

  return (
    <div className="actas" role="status">
      <Icon name="user" size="sm" />
      <span className="actas__text">
        در حال دیدن برنامه به‌جای <b>{asName}</b>، نقش <b>{asRole}</b>. هر کاری که اینجا انجام دهید به نام او ثبت می‌شود.
      </span>
      <button type="button" className="btn solid" onClick={() => void back()} disabled={busy}>
        {busy ? "در حال بازگشت…" : "بازگشت به حساب خودم"}
      </button>
    </div>
  );
}
