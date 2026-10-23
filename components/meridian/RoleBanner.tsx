"use client";

import { useState } from "react";
import { Alert, Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import { roleLabel, type Role } from "@/lib/roles";

/** Names the ACTIVE role, for someone holding more than one.
 *
 *  This is the same answer `ImpersonationBanner` already gives, reused rather than
 *  reinvented: "which world am I in?" and "who am I acting as?" are the same question, and
 *  a person who is both a driver and impersonated by an owner is in a state neither banner
 *  describes alone.
 *
 *  Not dismissible, and not shown to a single-role person — for them it is decoration, and
 *  the picker's own highlighted button already says which role is active. */
export default function RoleBanner({ role, roles }: { role: Role; roles: Role[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (roles.length < 2) return null;

  const others = roles.filter((r) => r !== role);

  async function switchTo(next: Role) {
    if (busy) return;
    setBusy(true);
    await fetch("/api/me/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: next }),
    }).catch(() => null);
    router.refresh();
  }

  return (
    <Alert status="accent" className="actas" role="status">
      <Alert.Indicator>
        <Icon name="users" size="sm" />
      </Alert.Indicator>
      <Alert.Content className="actas__text">
        <Alert.Description>
          نقش فعال شما: <b>{roleLabel(role)}</b>
        </Alert.Description>
      </Alert.Content>
      {others.map((r) => (
        <Button key={r} size="sm" variant="secondary" isDisabled={busy} onPress={() => void switchTo(r)}>
          <Icon name="users" size="md" />
          {roleLabel(r)}
        </Button>
      ))}
    </Alert>
  );
}
