"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

interface Person { id: number; display_name: string }
interface Loan { id: number; customer_name: string; from_name: string; to_name: string; until: string }

const FOR = [
  { id: "forever", label: "برای همیشه" },
  { id: "3", label: "۳ روز" },
  { id: "7", label: "یک هفته" },
  { id: "14", label: "دو هفته" },
  { id: "30", label: "یک ماه" },
];

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; customers?: number; tasks?: number; loans?: Loan[] } | null;
  return { ok: Boolean(res?.ok && j?.ok), error: j?.error ?? (res ? undefined : "ارتباط برقرار نشد"), customers: j?.customers ?? 0, tasks: j?.tasks ?? 0, loans: j?.loans ?? [] };
}

/** F59 + T13: hand all of one person's customers and open tasks to a colleague. The owner picks who, sees how many
 *  records would move, then confirms with that number in the button. The history of every customer says it.
 *  «برای همیشه» is the handover; a number of days only lends the customers, who go back by themselves (T13). */
export default function HandoverCard({ people }: { people: Person[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [span, setSpan] = useState("forever");
  const [loans, setLoans] = useState<Loan[]>([]);
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

  const loadLoans = useCallback(async () => {
    const r = await call("/api/admin/handover?loans=1");
    if (r.ok) setLoans(r.loans);
  }, []);
  useEffect(() => {
    void Promise.resolve().then(loadLoans);
  }, [loadLoans]);

  const name = (id: string) => people.find((p) => String(p.id) === id)?.display_name ?? "";
  const lending = span !== "forever";
  const nothing = size !== null && (lending ? size.customers : size.customers + size.tasks) === 0;

  async function go() {
    setBusy(true); setMsg("");
    const r = await call("/api/admin/handover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_user_id: Number(from), to_user_id: Number(to), ...(lending ? { days: Number(span) } : {}) }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "واگذاری انجام نشد"); return; }
    setMsg(lending ? `${faNum(r.customers)} مشتری برای ${faNum(Number(span))} روز به ${name(to)} قرض داده شد.` : `${faNum(r.customers)} مشتری و ${faNum(r.tasks)} کار به ${name(to)} سپرده شد.`);
    setFrom(""); setTo(""); setSpan("forever");
    await loadLoans();
  }

  async function giveBack(ids: number[]) {
    setBusy(true); setMsg("");
    const res = await fetch("/api/admin/handover", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loan_ids: ids }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setMsg("برگرداندن انجام نشد"); return; }
    await loadLoans();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="handover-title" data-tour="handover">
      <h2 id="handover-title" className="sechead__title mb-1">واگذاری کارهای یک همکار</h2>
      <p className="mb-3 text-sm text-text-muted">برای وقتی کسی می‌رود یا مرخصی طولانی دارد. همهٔ مشتری‌ها و کارهای باز او به همکار دیگری می‌رود و تاریخچه می‌ماند. اگر مدت بگذارید، فقط مشتری‌ها قرض داده می‌شوند و خودشان برمی‌گردند.</p>
      <p className="mb-1 text-sm">از چه کسی؟</p>
      <ChipGroup wrap group={{ id: "from", label: "از چه کسی", mode: "single", value: from, options: people.map((p) => ({ id: String(p.id), label: p.display_name })), onChange: (v) => { setFrom(v as string); if (v === to) setTo(""); } }} />
      {from && (
        <>
          <p className="mb-1 mt-3 text-sm">به چه کسی؟</p>
          <ChipGroup wrap group={{ id: "to", label: "به چه کسی", mode: "single", value: to, options: people.filter((p) => String(p.id) !== from).map((p) => ({ id: String(p.id), label: p.display_name })), onChange: (v) => setTo(v as string) }} />
        </>
      )}
      {from && to && (
        <>
          <p className="mb-1 mt-3 text-sm">تا کی؟</p>
          <ChipGroup wrap group={{ id: "span", label: "مدت", mode: "single", value: span, options: FOR, onChange: (v) => setSpan(v as string) }} />
        </>
      )}
      {nothing && <p className="mt-3 text-sm text-text-muted">{name(from)} مشتری یا کار بازی ندارد.</p>}
      {from && to && size && !nothing && (
        <button type="button" disabled={busy} onClick={() => void go()} className="btn solid mt-3 inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]">
          <Icon name="send" size="md" /> {lending ? `قرض دادن ${faNum(size.customers)} مشتری به ${name(to)}` : `سپردن ${faNum(size.customers)} مشتری و ${faNum(size.tasks)} کار به ${name(to)}`}
        </button>
      )}
      {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
      {loans.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">قرض‌های در جریان</p>
          <ul className="flex flex-col gap-2">
            {Object.values(
              loans.reduce<Record<string, { key: string; from: string; to: string; until: string; ids: number[] }>>((acc, l) => {
                const key = `${l.from_name}|${l.to_name}|${l.until}`;
                (acc[key] ??= { key, from: l.from_name, to: l.to_name, until: l.until, ids: [] }).ids.push(l.id);
                return acc;
              }, {})
            ).map((g) => (
              <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                <p className="text-sm">{faNum(g.ids.length)} مشتری از {g.from} پیش {g.to} است، تا {faJalaliDate(g.until)}</p>
                <button type="button" disabled={busy} onClick={() => void giveBack(g.ids)} className="btn min-h-[44px] inline-flex items-center gap-[var(--space-2)]">
                  <Icon name="undo" size="md" /> برگرداندن
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
