"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldInput } from "@/components/FieldInput";

export interface InfoProduct {
  id: number;
  name: string;
  category: string | null;
  selling_points: string | null;
  how_to_say: string | null;
  image_id: number | null;
}

/** What a rep says at the door about a product (VC1): a group, up to three selling points, a line on how
 *  to say it, a picture. Shown to the owner and managers on the price list; the van reads it in «کالاها». */
export default function ProductInfoEditor({ products }: { products: InfoProduct[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<InfoProduct | null>(null);
  const [category, setCategory] = useState("");
  const [points, setPoints] = useState(["", "", ""]);
  const [say, setSay] = useState("");
  const [imageId, setImageId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function start(p: InfoProduct) {
    setOpen(p);
    setCategory(p.category ?? "");
    const lines = (p.selling_points ?? "").split("\n").filter(Boolean);
    setPoints([lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""]);
    setSay(p.how_to_say ?? "");
    setImageId(p.image_id);
    setMsg("");
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/content-images", { method: "POST", body: form }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { id?: number; error?: string } | null;
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res?.ok || !j?.id) { setMsg(j?.error ?? "تصویر بارگذاری نشد"); return; }
    setImageId(j.id);
  }

  async function save() {
    if (!open) return;
    setBusy(true); setMsg("");
    const res = await fetch(`/api/sales/products/${open.id}/info`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, selling_points: points.filter((p) => p.trim()), how_to_say: say, image_id: imageId }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !j?.ok) { setMsg(j?.error ?? "ذخیره نشد"); return; }
    setOpen(null);
    router.refresh();
  }

  return (
    <section className="card p-[var(--space-4)]" aria-labelledby="pinfo-title" data-tour="product-info">
      <h2 id="pinfo-title" className="sechead__title">معرفی کالا برای فروشنده‌ها</h2>
      <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
        عکس، گروه و چند جملهٔ کوتاه که راننده و بازدیدکننده میدانی پشت در مشتری در «کالاها» می‌بینند. قیمت خرید هیچ‌وقت نشان داده نمی‌شود.
      </p>
      <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0">
        {products.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn ghost inline-flex w-full min-h-[44px] items-center justify-between gap-[var(--space-2)]" onClick={() => start(p)}>
              <Icon name="edit" size="sm" />
              <span>{p.name}</span>
              <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                {p.image_id || p.selling_points || p.how_to_say ? "تکمیل‌شده" : "هنوز چیزی نوشته نشده"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <BottomSheet open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} closeLabel="بستن معرفی کالا" dirty>
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <FieldInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="گروه، مثلاً «لبنیات»" aria-label="گروه کالا" maxLength={40} />
          {points.map((p, i) => (
            <FieldInput key={i} value={p} onChange={(e) => setPoints((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`نکتهٔ فروش ${i + 1}`} aria-label={`نکتهٔ فروش ${i + 1}`} maxLength={80} />
          ))}
          <FieldInput value={say} onChange={(e) => setSay(e.target.value)} placeholder="چه بگویم؟ مثلاً «برای آشپزخانهٔ شلوغ، دیرتر تمام می‌شود»" aria-label="جملهٔ پیشنهادی" maxLength={200} />
          {imageId !== null && (
            <img src={`/api/content-images/${imageId}/file?size=thumb`} alt="" width={160} height={160} style={{ borderRadius: 12 }} />
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <div className="flex gap-[var(--space-2)] flex-wrap">
            <button type="button" className="btn ghost inline-flex min-h-[44px] items-center gap-[var(--space-2)]" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="camera" size="md" /> {imageId === null ? "افزودن عکس" : "عوض کردن عکس"}
            </button>
            {imageId !== null && (
              <button type="button" className="btn ghost inline-flex min-h-[44px] items-center gap-[var(--space-2)]" disabled={busy} onClick={() => setImageId(null)}>
                <Icon name="trash" size="md" /> برداشتن عکس
              </button>
            )}
          </div>
          {msg && <p className="acad__muted" role="alert">{msg}</p>}
          <button type="button" className="btn solid inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]" disabled={busy} onClick={() => void save()}>
            <Icon name="save" size="md" /> ذخیرهٔ معرفی کالا
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
