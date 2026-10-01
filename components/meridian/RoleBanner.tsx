"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, type Role } from "@/lib/roles";

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
    <div className="actas" role="status">
      <span className="actas__text">
        نقش فعال شما: <b>{ROLE_LABEL[role] ?? role}</b>
      </span>
      {others.map((r) => (
        <button
          key={r}
          type="button"
          className="inline-flex items-center justify-center gap-[var(--space-2)] btn"
          disabled={busy}
          onClick={() => void switchTo(r)}
        >
          <Icon name="users" size="md" />
          {ROLE_LABEL[r] ?? r}
        </button>
      ))}
    </div>
  );
}
