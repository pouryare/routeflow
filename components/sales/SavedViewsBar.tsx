"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { canonicalQuery, sameView } from "@/lib/savedViews";
import type { SavedView } from "@/lib/repo/savedViews";

const BTN = "inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]";

/** FB6 saved views and T2 the unsaved-changes bar, on the orders list: tap a view to apply it; after changing a view's filter,
 *  save over it, save as a new one, or reset. Views are personal. */
export default function SavedViewsBar({ views }: { views: SavedView[] }) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams().toString();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = canonicalQuery(search);
  const active = views.find((v) => sameView(v.query, search)) ?? null;
  // the view whose name the person last picked: remembered in the address so a changed filter still knows where it came from
  const from = views.find((v) => String(v.id) === new URLSearchParams(search).get("sv")) ?? null;
  const dirty = from !== null && !sameView(from.query, search);

  const apply = (v: SavedView | null) => router.replace(v ? `${path}?${v.query}&sv=${v.id}` : path);
  async function call(init: RequestInit, url = "/api/saved-views") {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; id?: number } | undefined;
    setBusy(false);
    if (!res?.ok) setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
    return res?.ok ? j : null;
  }
  async function saveNew() {
    const j = await call({ method: "POST", body: JSON.stringify({ name, query: current }) });
    if (j) {
      setNaming(false);
      setName("");
      router.replace(`${path}?${current}&sv=${j.id}`);
      router.refresh();
    }
  }

  if (views.length === 0 && !current) return null;
  return (
    <div className="flex flex-col gap-[var(--space-2)] pb-2" data-tour="saved-views">
      {views.length > 0 ? (
        <div className="flex flex-wrap gap-[var(--space-2)]" role="group" aria-label="نمای‌های ذخیره‌شده">
          {views.map((v) => (
            <button key={v.id} type="button" aria-pressed={active?.id === v.id || from?.id === v.id} onClick={() => apply(v)} className={`${BTN} ${active?.id === v.id || from?.id === v.id ? "border-accent text-[var(--accent-text)]" : ""}`}>
              <Icon name="star" size="md" />
              {v.name}
            </button>
          ))}
        </div>
      ) : null}
      {dirty && from ? (
        <div className="flex flex-wrap items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-2)]">
          <span className="text-[length:var(--text-sm)]">«{from.name}» را تغییر داده‌اید</span>
          <button type="button" disabled={busy} className={BTN} onClick={async () => { if (await call({ method: "POST", body: JSON.stringify({ id: from.id, query: current }) })) router.refresh(); }}>
            <Icon name="save" size="md" />
            ذخیرهٔ تغییر
          </button>
          <button type="button" className={BTN} onClick={() => setNaming(true)}>
            <Icon name="save" size="md" />
            ذخیره به‌عنوان نمای تازه
          </button>
          <button type="button" className={BTN} onClick={() => apply(from)}>
            <Icon name="undo" size="md" />
            بازنشانی
          </button>
        </div>
      ) : null}
      {!from && !active && current ? (
        <button type="button" className={`${BTN} self-start`} onClick={() => setNaming(true)}>
          <Icon name="save" size="md" />
          ذخیرهٔ این فیلتر
        </button>
      ) : null}
      {active || from ? (
        <button type="button" disabled={busy} className={`${BTN} self-start`} onClick={async () => { const v = active ?? from; if (v && (await call({ method: "DELETE" }, `/api/saved-views?id=${v.id}`))) { router.replace(path); router.refresh(); } }}>
          <Icon name="trash" size="md" />
          حذف نمای «{(active ?? from)?.name}»
        </button>
      ) : null}
      {error && !naming ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <BottomSheet open={naming} title="ذخیرهٔ نما" onClose={() => setNaming(false)} closeLabel="بستن فرم نما">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <FieldInput value={name} onChange={(e) => setName(e.target.value)} placeholder="نام نما، مثلاً «امروز باز»" aria-label="نام نما" className="w-full" />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="save" isDisabled={busy || name.trim() === ""} onPress={() => void saveNew()}>ذخیرهٔ نما</GoButton>
        </div>
      </BottomSheet>
    </div>
  );
}
