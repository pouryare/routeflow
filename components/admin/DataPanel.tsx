"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import StickyAction from "@/components/mobile/StickyAction";
import { faNum } from "@/lib/format";
import { KIND_LABEL, type ItemStatus, type Plan, type PlanItem } from "@/lib/dataIO/importPlan";

const STATUS_LABEL: Record<ItemStatus, string> = { new: "تازه", changed: "تغییر می‌کند", same: "بدون تغییر", error: "خطا" };

interface Reply { ok?: boolean; error?: string; plan?: Plan; result?: { saved: number; byKind: Record<string, number> } }

async function send(file: File, confirm: boolean, groupId: string): Promise<Reply> {
  const body = new FormData();
  body.set("file", file);
  if (groupId) body.set("group_id", groupId);
  const res = await fetch(confirm ? "/api/admin/data/import" : "/api/admin/data/preview", { method: "POST", body }).catch(() => null);
  if (!res) return { error: "ارتباط برقرار نشد" };
  return ((await res.json().catch(() => null)) as Reply | null) ?? { error: "پاسخ نامعتبر" };
}

function Card({ item }: { item: PlanItem }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3" data-status={item.status}>
      <div className="flex items-center gap-2">
        <span className="chip" data-tone={item.status}>{STATUS_LABEL[item.status]}</span>
        <b className="min-w-0 flex-1 truncate">{item.label}</b>
        <span className="text-xs text-text-muted">{KIND_LABEL[item.kind]} · ردیف {faNum(item.row)}</span>
      </div>
      {item.error && <p className="mt-1 text-sm text-danger">{item.error}</p>}
      {item.changes.map((c) => (
        <p key={c.field} className="mt-1 text-sm">
          <span className="text-text-muted">{c.field}: </span>
          <del className="text-text-muted">{c.from || "خالی"}</del> ← <b>{c.to}</b>
        </p>
      ))}
    </li>
  );
}

/** F34: the export, and the upload with a preview that reads like a change list rather than a diff:
 *  every row says whether it is new, changes (old ← new), stays the same, or is refused and why. */
export default function DataPanel({ groups }: { groups: { id: number; name: string }[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [show, setShow] = useState<"" | ItemStatus>("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function pick(f: File | undefined) {
    if (!f) return;
    setFile(f); setPlan(null); setMsg(""); setShow(""); setBusy(true);
    const r = await send(f, false, "");
    setBusy(false);
    if (r.plan) setPlan(r.plan); else setMsg(r.error ?? "فایل خوانده نشد");
  }

  async function save() {
    if (!file) return;
    setBusy(true); setMsg("");
    const r = await send(file, true, groupId);
    setBusy(false);
    if (!r.result) { setMsg(r.error ?? "ثبت نشد"); return; }
    const by = r.result.byKind;
    setMsg(`${faNum(r.result.saved)} ردیف ثبت شد: ${faNum(by.customers ?? 0)} مشتری، ${faNum(by.products ?? 0)} کالا، ${faNum(by.prices ?? 0)} قیمت.`);
    setPlan(null); setFile(null);
  }

  const todo = plan ? plan.counts.new + plan.counts.changed : 0;
  const items = plan?.items.filter((i) => !show || i.status === show) ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="export-title" data-tour="data-export">
        <h2 id="export-title" className="sechead__title mb-1">دریافت همهٔ داده‌ها</h2>
        <p className="mb-3 text-sm text-text-muted">یک فایل اکسل با برگه‌های مشتریان، کالاها، قیمت‌ها، سفارش‌ها و پرداخت‌ها. سه برگهٔ اول را می‌شود ویرایش کرد و همین‌جا دوباره بارگذاری کرد.</p>
        <a href="/api/admin/data/export" download className="btn solid inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]">
          <Icon name="download" size="md" /> دریافت فایل اکسل
        </a>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="import-title" data-tour="data-import">
        <h2 id="import-title" className="sechead__title mb-1">بارگذاری از اکسل</h2>
        <p className="mb-3 text-sm text-text-muted">فایل را انتخاب کنید؛ پیش از ثبت، برای هر ردیف می‌بینید چه چیزی تازه است، چه چیزی از چه به چه عوض می‌شود و کدام ردیف خطا دارد. تا تأیید نکنید چیزی ذخیره نمی‌شود. خانهٔ خالی چیزی را پاک نمی‌کند.</p>
        <input ref={input} type="file" accept=".xlsx,.csv" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]">
          <Icon name="upload" size="md" /> {file ? "انتخاب فایل دیگر" : "انتخاب فایل اکسل"}
        </button>
        {file && <p className="mt-2 text-sm text-text-muted">{file.name}</p>}
        {busy && !plan && <p className="mt-2 text-sm" role="status">در حال خواندن فایل…</p>}
        {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
      </section>

      {plan && (
        <section aria-label="پیش‌نمایش تغییرات" data-tour="data-preview" className="sticky-action-gap space-y-3">
          <ChipGroup wrap group={{
            id: "status", label: "نمایش", mode: "single", value: show,
            options: (["new", "changed", "same", "error"] as const).map((s) => ({ id: s, label: `${STATUS_LABEL[s]} (${faNum(plan.counts[s])})` })),
            onChange: (v) => setShow(v as "" | ItemStatus),
          }} />
          {plan.counts.new > 0 && plan.kinds.includes("customers") && groups.length > 0 && (
            <div>
              <p className="mb-1 text-sm">گروه مشتریان تازه (اختیاری)</p>
              <ChipGroup wrap group={{ id: "group", label: "گروه", mode: "single", value: groupId, options: groups.map((g) => ({ id: String(g.id), label: g.name })), onChange: (v) => setGroupId(v as string) }} />
            </div>
          )}
          <ul className="space-y-2">{items.map((i) => <Card key={`${i.kind}-${i.row}`} item={i} />)}</ul>
          {items.length === 0 && <p className="text-sm text-text-muted">ردیفی در این بخش نیست.</p>}
          <StickyAction
            icon="check"
            label={todo ? `ثبت ${faNum(todo)} تغییر` : "چیزی برای ثبت نیست"}
            disabled={busy || todo === 0}
            busy={busy ? "در حال ثبت…" : undefined}
            onClick={() => void save()}
          />
        </section>
      )}
    </div>
  );
}
