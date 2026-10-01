"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import { roleLabel, type Role } from "@/lib/roles";

/* The role switcher — the one user-visible thing multi-role adds.
 *
 * Shown ONLY to someone holding 2+ roles. A single-role person must never see a decision
 * they did not ask for and have only one possible answer: the picker is noise on the one
 * screen every person opens every day, and it invites people to "switch" into the role they
 * already have. That invisibility is the feature's main UX guarantee.
 *
 * It posts to /api/me/role, which re-reads the SET server-side and refuses a role the person
 * does not hold. This component's list is a convenience, never the authority. */

export default function RolePicker({ roles, active }: { roles: Role[]; active: Role }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (roles.length < 2) return null;

  async function pick(role: Role) {
    if (role === active || busy) return;
    setBusy(true);
    // A cookie round-trip: the active role is a CLAIM, and proxy.ts reads the claim without
    // touching the database. So the server has to re-sign before the shell can change.
    await fetch("/api/me/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }).catch(() => null);
    // refresh() re-runs every server component against the new cookie, so the tabs, the
    // briefing and the data are the new role's — not just the URL.
    router.refresh();
  }

  return (
    <nav aria-label="نقش فعال" className="mb-[var(--space-3)] flex flex-wrap gap-[var(--space-2)]">
      {roles.map((r) => {
        const on = r === active;
        return (
          <button
            key={r}
            type="button"
            aria-current={on ? "true" : undefined}
            disabled={busy}
            onClick={() => void pick(r)}
            className={
              "rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] " +
              "disabled:opacity-60 " +
              (on
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-raised)]")
            }
          >
            <Icon name="users" size="sm" />
            {roleLabel(r)}
          </button>
        );
      })}
    </nav>
  );
}
