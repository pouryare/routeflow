"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Alert, Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";

const KEY = "rf_2fa_nudge_hidden_until";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hidden «تا فردا» on this phone: true while the person's own «بعداً» is still in force. */
export function nudgeHidden(raw: string | null, now = Date.now()): boolean {
  const until = Number(raw);
  return Number.isFinite(until) && until > now;
}

/** Authenticator nudge (FB29): a manager without the authenticator is asked to turn it on, with
 *  «فعال‌سازی اکنون» straight to «امنیت و ورود». Nobody is locked out; «بعداً» hides it for a day on
 *  this phone. AppHeader decides who sees it (lib/stepUp.ts needsStepUp, not enrolled yet). */
// The choice lives in this phone's storage, read as an external store (as HideMoneyButton does).
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const read = (): boolean => {
  try {
    return nudgeHidden(localStorage.getItem(KEY));
  } catch {
    return false; /* no storage: shown */
  }
};

export default function AuthenticatorNudge() {
  // Hidden on the server render, so a person who chose «بعداً» never sees it flash.
  const hidden = useSyncExternalStore(subscribe, read, () => true);
  if (hidden) return null;

  const later = () => {
    try { localStorage.setItem(KEY, String(Date.now() + DAY_MS)); } catch { /* not kept */ }
    listeners.forEach((l) => l());
  };

  return (
    <Alert status="warning" className="actas" role="status">
      <Alert.Indicator>
        <Icon name="key" size="sm" />
      </Alert.Indicator>
      <Alert.Content className="actas__text">
        <Alert.Description>ورود دومرحله‌ای شما خاموش است؛ کارهای حساس بدون آن انجام نمی‌شوند.</Alert.Description>
      </Alert.Content>
      <Link href="/settings/security" className="btn solid inline-flex min-h-[44px] items-center gap-[var(--space-2)]">
        <Icon name="key" size="md" />
        فعال‌سازی اکنون
      </Link>
      <Button size="sm" variant="ghost" className="min-h-[44px]" onPress={later}>
        <Icon name="clock" size="md" />
        بعداً
      </Button>
    </Alert>
  );
}
