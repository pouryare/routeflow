"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";

/** Shown on every shell page while the platform owner is acting in ONE company.
 *
 *  In that state every read and every write is that company's (the session behaves as its owner),
 *  so forgetting which company you are in is the mistake to prevent: a customer added, a price
 *  changed or a staff member deactivated in the wrong place. It cannot be dismissed; «همهٔ سازمان‌ها»
 *  goes back through POST /api/admin/acting-org and refreshes, so every server component re-reads
 *  the session. A HeroUI warning Alert, like the Login-As banner. */
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
    <Alert status="warning" className="actas" role="status">
      <Alert.Indicator>
        <Icon name="building" size="sm" />
      </Alert.Indicator>
      <Alert.Content className="actas__text">
        <Alert.Description>
          در حال کار در سازمان <b>{name}</b> به‌عنوان مالک آن. هر تغییری که اینجا انجام دهید در همین سازمان ثبت می‌شود.
        </Alert.Description>
      </Alert.Content>
      <Button size="sm" variant="primary" onPress={() => void all()} isDisabled={busy}>
        <Icon name="building" size="md" />
        {busy ? "در حال بازگشت…" : "همهٔ سازمان‌ها"}
      </Button>
    </Alert>
  );
}
