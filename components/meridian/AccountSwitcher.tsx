"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import Avatar from "@/components/meridian/Avatar";
import { roleLabel } from "@/lib/roles";
import SectionHead from "@/components/meridian/SectionHead";

type Row = {
  id: number;
  display_name: string;
  role: string;
  roles: string[];
  organization_id: number;
  organization_name: string;
  isSelf: boolean;
};

/* The account switcher — ONE component, mounted twice (spec P8).
 *
 * A: inside the ProfileMenu dropdown, behind «ورود به‌عنوان…».
 * B: at /switch, the full page.
 *
 * It is deliberately NOT written into the menu's markup. Mounting it in two places is the
 * point: when the account count makes a dropdown cramped, mount B already exists and A
 * becomes a link to it. Inlining the list would make that a rewrite.
 *
 * Grouped by organisation, because the founder works across tenants and the org is the
 * thing that is easy to forget once two tenants both employ a رضا.
 *
 * The list is a convenience, never the authority: the server re-reads the role set and
 * refuses an account this person may not become. */

export default function AccountSwitcher({ variant = "page" }: { variant?: "menu" | "page" }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  /* The account the person is about to act as. Nothing is sent until they tap the confirm
     button: every write from here on is recorded as this person with our name beside it. */
  const [asking, setAsking] = useState<Row | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/impersonatable")
      .then((r) => r.json())
      .then((d: { users?: Row[] }) => setRows(d.users ?? []))
      .catch(() => setRows([]));
  }, []);

  const byOrg = useMemo(() => {
    const m = new Map<number, { name: string; rows: Row[] }>();
    for (const r of rows) {
      if (q && !`${r.display_name} ${r.organization_name}`.includes(q)) continue;
      const e = m.get(r.organization_id) ?? { name: r.organization_name, rows: [] };
      e.rows.push(r);
      m.set(r.organization_id, e);
    }
    return [...m.values()];
  }, [rows, q]);

  function actAs(row: Row) {
    if (row.isSelf || busy !== null) return;
    setAsking(row);
  }

  async function confirmActAs(row: Row) {
    if (row.isSelf || busy !== null) return;
    setAsking(null);
    setBusy(row.id);
    await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: row.id }),
    }).catch(() => null);
    // refresh() re-runs every server component against the new cookie, so the tabs, the
    // briefing and the data are the TARGET's — not just the URL.
    router.push("/");
    router.refresh();
  }

  return (
    <div className={variant === "page" ? "p-[var(--space-4)]" : ""} dir="rtl">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="جستجوی نام یا سازمان…" aria-label="جستجوی نام یا سازمان"
        className="mb-[var(--space-3)] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      {asking && (
        <div role="alertdialog" aria-label="ورود به‌جای کاربر" className="mb-[var(--space-3)] grid gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]">
          <p className="m-0 text-[length:var(--text-sm)]">
            برنامه را به‌جای «{asking.display_name}» ببینید؟ تا وقتی «بازگشت به حساب خودم» را نزنید، هر کاری که انجام دهید به نام او ثبت می‌شود.
          </p>
          <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => void confirmActAs(asking)}>
            <Icon name="check" size="md" />
            دیدن برنامه به‌جای «{asking.display_name}»
          </button>
          <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => setAsking(null)}>
            <Icon name="x" size="md" />
            انصراف از ورود به‌جای کاربر
          </button>
        </div>
      )}
      {byOrg.length === 0 && (
        <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">حسابی یافت نشد</p>
      )}
      {byOrg.map((org) => (
        <section key={org.name} className="mb-[var(--space-4)]">
          {/* SectionHead, not a hand-styled h3: tests/section-headings.test.ts requires
              one component to own every heading, and a bare h3 here is a second dialect. */}
          <SectionHead title={org.name} className="mb-[var(--space-2)]" />
          <ul className="m-0 list-none p-0">
            {org.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={r.isSelf || busy !== null}
                  onClick={() => actAs(r)}
                  className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-2)] py-[var(--space-2)] text-right disabled:opacity-40 enabled:hover:bg-[var(--surface-raised)]"
                >
                  <Icon name="users" size="md" />
                  <Avatar userId={r.id} name={r.display_name} size={26} />
                  <span className="flex-1">
                    <span className="block text-[length:var(--text-sm)] text-[var(--text)]">
                      {r.display_name}
                    </span>
                    {/* Every hat, not just the primary: the point of the feature is to see
                        what this person really is. */}
                    <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                      {r.roles.map((x) => roleLabel(x)).join("، ")}
                    </span>
                  </span>
                  {r.isSelf && (
                    <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">خودِ شما</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
