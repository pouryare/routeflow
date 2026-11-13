"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldInput } from "@/components/FieldInput";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

interface Person { id: number; display_name: string }
interface Asset { id: number; kind: string; name: string; serial: string | null; holder_user_id: number | null; holder_name: string | null; holder_since: string | null; condition: string }

const KINDS = [
  { id: "van", label: "ون" }, { id: "phone", label: "موبایل" }, { id: "tablet", label: "تبلت" },
  { id: "printer", label: "پرینتر" }, { id: "scale", label: "ترازو" }, { id: "key", label: "کلید" }, { id: "other", label: "سایر" },
];
const CONDITIONS = [{ id: "good", label: "سالم" }, { id: "worn", label: "فرسوده" }, { id: "broken", label: "خراب" }];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));
const COND_LABEL = Object.fromEntries(CONDITIONS.map((c) => [c.id, c.label]));

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; assets?: Asset[] } | null;
  return { ok: Boolean(res?.ok && j?.ok), error: j?.error ?? (res ? undefined : "ارتباط برقرار نشد"), assets: j?.assets ?? [] };
}
const send = (method: string, body: unknown) => call("/api/admin/assets", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** F140: the company's things (vans, phones, tablets, printers, scales, keys), who holds each and its condition.
 *  Tap a row to give it to someone, set its condition or retire it. */
export default function AssetsCard({ people }: { people: Person[] }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState("phone");
  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await call("/api/admin/assets");
    if (r.ok) setAssets(r.assets);
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(p: Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true); setMsg("");
    const r = await p;
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "ثبت نشد"); return; }
    after?.();
    await load();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="assets-title" data-tour="assets">
      <h2 id="assets-title" className="sechead__title mb-1">دارایی‌های شرکت</h2>
      <p className="mb-3 text-sm text-text-muted">ون، موبایل، تبلت، پرینتر، ترازو و کلید: چه چیزی دست چه کسی است و در چه وضعیتی.</p>

      {assets.length === 0 ? (
        <p className="mb-3 text-sm text-text-muted">هنوز چیزی ثبت نشده است. «افزودن» را بزنید.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {assets.map((a) => (
            <li key={a.id} className="rounded-md border border-border">
              <button type="button" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} className="flex min-h-[44px] w-full items-center justify-between gap-2 p-3 text-start">
                <span>
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-sm text-text-muted">
                    {KIND_LABEL[a.kind] ?? a.kind}{a.serial ? ` · ${a.serial}` : ""} · {COND_LABEL[a.condition] ?? "نامشخص"}
                  </span>
                  <span className="block text-sm">{a.holder_name ? `دست ${a.holder_name}${a.holder_since ? ` از ${faJalaliDate(a.holder_since)}` : ""}` : "در انبار"}</span>
                </span>
                <Icon name="chevron-down" size="md" className={open === a.id ? "rotate-180" : ""} />
              </button>
              {open === a.id && (
                <div className="border-t border-border p-3">
                  <p className="mb-1 text-sm">دست چه کسی است؟</p>
                  <ChipGroup wrap group={{ id: `h${a.id}`, label: "نگه‌دارنده", mode: "single", value: a.holder_user_id === null ? "" : String(a.holder_user_id), options: people.map((p) => ({ id: String(p.id), label: p.display_name })), onChange: (v) => void run(send("PATCH", { id: a.id, holder: v === "" ? null : Number(v) })) }} />
                  <p className="mb-1 mt-3 text-sm">وضعیت</p>
                  <ChipGroup wrap group={{ id: `c${a.id}`, label: "وضعیت", mode: "single", value: a.condition, options: CONDITIONS, onChange: (v) => { if (v) void run(send("PATCH", { id: a.id, condition: v })); } }} />
                  <button type="button" disabled={busy} onClick={() => void run(send("PATCH", { id: a.id, retire: true }), () => setOpen(null))} className="btn mt-3 inline-flex min-h-[44px] items-center gap-[var(--space-2)]">
                    <Icon name="archive" size="md" /> از رده خارج شد
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div>
          <p className="mb-1 text-sm">چه چیزی؟</p>
          <ChipGroup wrap group={{ id: "kind", label: "نوع", mode: "single", value: kind, options: KINDS, onChange: (v) => setKind((v as string) || kind) }} />
          <FieldInput aria-label="نام" placeholder="نام، مثلاً «موبایل سامسونگ علی»" value={name} onChange={(e) => setName(e.target.value)} className="mt-3 w-full" />
          <FieldInput aria-label="شماره سریال" placeholder="شماره سریال (اختیاری)" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} className="mt-2 w-full" />
          <button type="button" disabled={busy || !name.trim()} onClick={() => void run(send("POST", { kind, name, serial }), () => { setName(""); setSerial(""); setAdding(false); })} className="btn solid mt-3 inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]">
            <Icon name="plus" size="md" /> ثبت در فهرست
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="btn inline-flex min-h-[44px] items-center gap-[var(--space-2)]">
          <Icon name="plus" size="md" /> افزودن
        </button>
      )}
      {assets.length > 0 && <p className="mt-3 text-sm text-text-muted">{faNum(assets.length)} مورد در فهرست</p>}
      {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
    </section>
  );
}
