"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { faNum } from "@/lib/format";

interface Person { id: number; display_name: string }

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; customers?: number; tasks?: number } | null;
  return { ok: Boolean(res?.ok && j?.ok), error: j?.error ?? (res ? undefined : "ارتباط برقرار نشد"), customers: j?.customers ?? 0, tasks: j?.tasks ?? 0 };
}

/** F59: hand all of one person's customers and open tasks to a colleague. The owner picks who, sees how many
 *  records would move, then confirms with that number in the button. The history of every customer says it. */
export default function HandoverCard({ people }: { people: Person[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [size, setSize] = useState<{ customers: number; tasks: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    // Reading the size of what the chosen person holds; reset first so a stale number never sits beside a new name.
    void Promise.resolve().then(async () => {
      if (!live) return;
      setSize(null);
      if (!from) return;
      const r = await call(`/api/admin/handover?from=${from}`);
      if (live && r.ok) setSize({ customers: r.customers, tasks: r.tasks });
    });
    return () => { live = false; };
  }, [from]);

  const name = (id: string) => people.find((p) => String(p.id) === id)?.display_name ?? "";
  const nothing = size !== null && size.customers + size.tasks === 0;

  async function go() {
    setBusy(true); setMsg("");
    const r = await call("/api/admin/handover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_user_id: Number(from), to_user_id: Number(to) }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "واگذاری انجام نشد"); return; }
    setMsg(`${faNum(r.customers)} مشتری و ${faNum(r.tasks)} کار به ${name(to)} سپرده شد.`);
    setFrom(""); setTo("");
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="handover-title" data-tour="handover">
      <h2 id="handover-title" className="sechead__title mb-1">واگذاری کارهای یک همکار</h2>
      <p className="mb-3 text-sm text-text-muted">برای وقتی کسی می‌رود یا مرخصی طولانی دارد. همهٔ مشتری‌ها و کارهای باز او به همکار دیگری می‌رود و تاریخچه می‌ماند.</p>
      <p className="mb-1 text-sm">از چه کسی؟</p>
      <ChipGroup wrap group={{ id: "from", label: "از چه کسی", mode: "single", value: from, options: people.map((p) => ({ id: String(p.id), label: p.display_name })), onChange: (v) => { setFrom(v as string); if (v === to) setTo(""); } }} />
      {from && (
        <>
          <p className="mb-1 mt-3 text-sm">به چه کسی؟</p>
          <ChipGroup wrap group={{ id: "to", label: "به چه کسی", mode: "single", value: to, options: people.filter((p) => String(p.id) !== from).map((p) => ({ id: String(p.id), label: p.display_name })), onChange: (v) => setTo(v as string) }} />
        </>
      )}
      {nothing && <p className="mt-3 text-sm text-text-muted">{name(from)} مشتری یا کار بازی ندارد.</p>}
      {from && to && size && !nothing && (
        <button type="button" disabled={busy} onClick={() => void go()} className="btn solid mt-3 inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]">
          <Icon name="send" size="md" /> سپردن {faNum(size.customers)} مشتری و {faNum(size.tasks)} کار به {name(to)}
        </button>
      )}
      {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
    </section>
  );
}
