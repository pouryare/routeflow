"use client";

import { useState } from "react";
import { useToast } from "./ToastProvider";
import { faNum } from "@/lib/format";
import { Icon, type IconName } from "@/components/meridian/Icon";

interface ParsedItem {
  key: string;
  name: string;
  mapsUrl: string;
  resolvedUrl: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  resolution: "direct" | "pluscode" | "nominatim" | "manual" | "unresolved";
  alreadySaved: boolean;
  duplicateOf: { kind: "location" | "customer"; name: string } | null;
  batchDuplicateKeys: string[];
}

const RESOLUTION_META: Record<
  ParsedItem["resolution"],
  { icon: IconName; label: string; color: string }
> = {
  direct: { icon: "check", label: "دقیق", color: "var(--good)" },
  pluscode: { icon: "check", label: "دقیق", color: "var(--good)" },
  nominatim: { icon: "target", label: "تقریبی", color: "var(--accent)" },
  manual: { icon: "map-pin", label: "دستی", color: "var(--good)" },
  unresolved: { icon: "warn", label: "نیاز به مکان‌یابی دستی", color: "var(--warn)" },
};

export default function LeadImportPanel({ onAdded }: { onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergedKeys, setMergedKeys] = useState<Set<string>>(new Set());
  const toast = useToast();

  async function parse() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/locations/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "خطا در تجزیه متن", "error");
        return;
      }
      const parsed = data.items as ParsedItem[];
      setItems(parsed);
      setSelected(new Set(parsed.filter((it) => !it.alreadySaved && !it.duplicateOf).map((it) => it.key)));
      setMergedKeys(new Set());
      const resolvedCount = parsed.filter((it) => it.resolution !== "unresolved").length;
      const duplicateCount = parsed.filter((it) => it.duplicateOf || it.batchDuplicateKeys.length > 0).length;
      toast(
        `${faNum(parsed.length)} مکان پیدا شد (${faNum(resolvedCount)} با مختصات دقیق)` +
          (duplicateCount ? ` — ${faNum(duplicateCount)} مورد مشابه موارد موجود به نظر می‌رسد` : ""),
        resolvedCount === parsed.length && !duplicateCount ? "success" : "info"
      );
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
    }
  }

  function rename(key: string, name: string) {
    setItems((prev) => (prev ? prev.map((it) => (it.key === key ? { ...it, name } : it)) : prev));
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMerge(key: string) {
    setMergedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function addSelected() {
    if (!items) return;
    const chosen = items.filter((it) => selected.has(it.key));
    if (chosen.length === 0) return;
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chosen.map((it) => ({ name: it.name, mapsUrl: it.mapsUrl, lat: it.lat, lng: it.lng, address: it.address })) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const mergeEntries = chosen.filter((it) => mergedKeys.has(it.key) && it.duplicateOf);
      if (mergeEntries.length > 0) {
        for (const entry of mergeEntries) {
          try { await fetch(`/api/locations/${entry.duplicateOf!.name}/merge`, { method: "POST" }); } catch { /* ignore */ }
        }
      }
      toast(`${faNum(chosen.length)} مکان اضافه شد`, "success");
      setItems(null);
      setText("");
      setMergedKeys(new Set());
      onAdded();
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "خطا در افزودن مکان", "error");
    }
  }

  function renderItem(it: ParsedItem) {
    const isMerged = mergedKeys.has(it.key);
    const batchDupCount = it.batchDuplicateKeys.length;
    const rm = RESOLUTION_META[it.resolution];
    return (
      <li key={it.key} className={`flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 ${it.alreadySaved ? "border-border bg-surface opacity-60" : "border-border bg-surface"} ${isMerged ? "border-accent bg-accent/5" : ""}`}>
        <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggle(it.key)} className="mt-1 accent-[color:var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <input value={it.name} onChange={(e) => rename(it.key, e.target.value)} aria-label="نام مکان" className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-border focus:border-accent" />
            <span className="shrink-0 font-mono text-[length:var(--text-xs)]" style={{ color: rm.color }}><Icon name={rm.icon} size="sm" /> {rm.label}</span>
          </div>
          {it.address && <p className="truncate text-[length:var(--text-xs)] text-text-faint">{it.address}</p>}
          {it.alreadySaved && <p className="text-[length:var(--text-xs)] text-text-faint">قبلاً در فهرست ذخیره شده</p>}
          {!it.alreadySaved && it.duplicateOf && (
            <div className="flex items-center gap-2 mt-1">
              <p className="truncate text-[length:var(--text-xs)] text-warn"><Icon name="warn" size="sm" /> شبیه «{it.duplicateOf.name}» ({it.duplicateOf.kind === "customer" ? "مشتری موجود" : "فهرست مکان‌ها"})</p>
              <button type="button" onClick={() => toggleMerge(it.key)} className={`shrink-0 rounded px-1.5 py-0.5 text-[length:var(--text-xs)] border transition-colors ${isMerged ? "border-accent bg-accent text-accent-ink" : "border-border text-text-faint hover:border-accent hover:text-accent"}`}>{isMerged ? <>لینک شد <Icon name="check" size="sm" /></> : "لینک با موجودی"}</button>
            </div>
          )}
          {batchDupCount > 0 && !it.duplicateOf && (
            <p className="text-[length:var(--text-xs)] text-text-faint mt-1"><Icon name="warn" size="sm" /> {batchDupCount} تکرار در این دسته {batchDupCount > 1 ? "ها" : ""} {selected.has(it.key) && !mergedKeys.has(it.key) && <><button type="button" onClick={() => toggleMerge(it.key)} className="mr-1 text-accent underline">لینک با یکی از آنها</button></>}</p>
          )}
        </div>
      </li>
    );
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <h2 className="sechead__title mb-2">افزودن از لینک</h2>
      {!items ? (
        <div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="لینک یا نتیجه جستجوی گوگل‌مپس را اینجا پیست کنید…" className="w-full h-24 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:ring-1 focus:ring-accent resize-none" />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[length:var(--text-xs)] text-text-faint">لینک‌های گوگل‌مپس، نشان و بلد پشتیبانی می‌شوند.</p>
            <button onClick={parse} disabled={busy || !text.trim()} className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50">{busy ? "در حال تجزیه…" : "تجزیه"}</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[length:var(--text-xs)] text-text-muted">{items.length} مکان پیدا شد</p>
            <button onClick={() => { setItems(null); setText(""); }} className="text-[length:var(--text-xs)] text-text-faint hover:text-text">انصراف</button>
          </div>
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">{items.map(renderItem)}</ul>
          <button onClick={addSelected} disabled={busy || selected.size === 0} className="mt-3 w-full rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50">{busy ? "در حال افزودن..." : `افزودن ${faNum(selected.size)} مورد به فهرست`}</button>
        </div>
      )}
    </section>
  );
}
