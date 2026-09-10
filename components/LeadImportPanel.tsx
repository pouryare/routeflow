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
      const resolvedCount = parsed.filter((it) => it.resolution !== "unresolved").length;
      const duplicateCount = parsed.filter((it) => it.duplicateOf).length;
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

  // A name derived from the resolved Google address (what a link pasted without one gets)
  // is a good guess, not a certainty -- and saved locations have no rename anywhere else,
  // so the preview is the only chance to correct it.
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

  async function addSelected() {
    if (!items) return;
    const chosen = items.filter((it) => selected.has(it.key));
    if (chosen.length === 0) return;
    // A location saved with no name can't be found or matched later, and the API drops it
    // silently -- so an emptied name field is caught here rather than lost on submit.
    if (chosen.some((it) => !it.name.trim())) {
      toast("نام مکان نمی‌تواند خالی باشد", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: chosen.map((it) => ({
            name: it.name,
            mapsUrl: it.mapsUrl,
            address: it.address,
            lat: it.lat,
            lng: it.lng,
            resolution: it.resolution,
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "خطا در افزودن", "error");
        return;
      }
      toast(`${data.added} مکان به لیست اضافه شد${data.skipped ? ` (${data.skipped} تکراری بود)` : ""}`, "success");
      setItems(null);
      setText("");
      onAdded();
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <h2 className="sechead__title mb-2">
        استخراج مکان از گفتگو
      </h2>

      {!items ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="متن گفتگو حاوی نام و لینک نقشه را اینجا پیست کنید…"
            rows={6}
            dir="ltr"
            className="w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 font-mono text-[length:var(--text-xs)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
          />
          <button
            onClick={parse}
            disabled={busy || !text.trim()}
            className="mt-2 rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "در حال استخراج و مکان‌یابی…" : "تجزیه"}
          </button>
          <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">
            لینک‌های گوگل‌مپس، نشان و بلد پشتیبانی می‌شوند. نام هر مکان از پیامی که لینک در آن پیست شده برداشته می‌شود.
          </p>
        </>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[length:var(--text-xs)] text-text-muted">{items.length} مکان پیدا شد</p>
            <button
              onClick={() => {
                setItems(null);
                setText("");
              }}
              className="text-[length:var(--text-xs)] text-text-faint hover:text-text"
            >
              انصراف
            </button>
          </div>
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {items.map((it) => (
              <li
                key={it.key}
                className={`flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 ${
                  it.alreadySaved ? "border-border bg-surface opacity-60" : "border-border bg-surface"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(it.key)}
                  onChange={() => toggle(it.key)}
                  className="mt-1 accent-[color:var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={it.name}
                      onChange={(e) => rename(it.key, e.target.value)}
                      aria-label="نام مکان"
                      className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-border focus:border-accent"
                    />
                    <span
                      className="shrink-0 font-mono text-[length:var(--text-xs)]"
                      style={{ color: RESOLUTION_META[it.resolution].color }}
                    >
                      <Icon name={RESOLUTION_META[it.resolution].icon} size="sm" />{" "}
                      {RESOLUTION_META[it.resolution].label}
                    </span>
                  </div>
                  {it.address && <p className="truncate text-[length:var(--text-xs)] text-text-faint">{it.address}</p>}
                  {it.alreadySaved && <p className="text-[length:var(--text-xs)] text-text-faint">قبلاً در لیست ذخیره شده</p>}
                  {!it.alreadySaved && it.duplicateOf && (
                    <p className="truncate text-[length:var(--text-xs)] text-warn">
                      <Icon name="warn" size="sm" /> شبیه «{it.duplicateOf.name}» ({it.duplicateOf.kind === "customer" ? "مشتری موجود" : "لیست مکان‌ها"})
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={addSelected}
            disabled={busy || selected.size === 0}
            className="mt-3 w-full rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "در حال افزودن..." : `افزودن ${faNum(selected.size)} مورد به لیست`}
          </button>
        </div>
      )}
    </section>
  );
}
