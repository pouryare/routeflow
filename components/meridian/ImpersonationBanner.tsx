"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@heroui/react";
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
    <Alert status="warning" className="actas" role="status">
      <Alert.Indicator>
        <Icon name="user" size="sm" />
      </Alert.Indicator>
      <Alert.Content className="actas__text">
        <Alert.Description>
          در حال دیدن برنامه به‌جای <b>{asName}</b>، نقش <b>{asRole}</b>. هر کاری که اینجا انجام دهید به نام او ثبت می‌شود.
        </Alert.Description>
      </Alert.Content>
      <Button size="sm" variant="primary" onPress={() => void back()} isDisabled={busy}>
        <Icon name="arrow-right" size="md" />
        {busy ? "در حال بازگشت…" : "بازگشت به حساب خودم"}
      </Button>
    </Alert>
  );
}
