"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChipGroup, type FilterGroup } from "@/components/mobile/ChipGroup";
import SectionHead from "@/components/meridian/SectionHead";

type Org = { id: number; name: string; active: number };

/** The platform owner's company picker: «همهٔ سازمان‌ها» (the default, everything at once) or one
 *  company to act in as its owner, for reads AND writes. Chips, not a dropdown (house rule). The
 *  list is a convenience; the server re-validates the choice on every request (lib/session.ts) and
 *  only a real platform_owner session may switch (POST /api/admin/acting-org). */
export default function ActingCompany() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [acting, setActing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/acting-org")
      .then((r) => r.json())
      .then((d: { organizations?: Org[]; acting?: number | null }) => {
        setOrgs((d.organizations ?? []).filter((o) => o.active));
        setActing(d.acting ?? null);
      })
      .catch(() => setOrgs([]));
  }, []);

  async function choose(id: number | null) {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/admin/acting-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: id }),
    }).catch(() => null);
    if (res?.ok) setActing(id);
    // refresh() re-runs every server component against the new cookie, so the pages, the tabs and
    // the data are the chosen company's, not just this control.
    router.refresh();
    setBusy(false);
  }

  const group: FilterGroup = {
    id: "acting-org",
    label: "سازمان فعال",
    mode: "single",
    neutral: "",
    value: acting === null ? "" : String(acting),
    onChange: (v) => void choose(v === "" || Array.isArray(v) ? null : Number(v)),
    options: [{ id: "", label: "همهٔ سازمان‌ها" }, ...orgs.map((o) => ({ id: String(o.id), label: o.name }))],
  };

  return (
    <section className="mt-[var(--space-4)]" aria-label="سازمان فعال">
      <SectionHead title="سازمان فعال" />
      <p className="m-0 mt-[var(--space-1)] mb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
        «همهٔ سازمان‌ها» همه را با هم می‌بیند. با انتخاب یک سازمان، به‌عنوان مالک همان سازمان کار می‌کنید و هر تغییری در همان سازمان ثبت می‌شود.
      </p>
      <ChipGroup group={group} wrap />
    </section>
  );
}
