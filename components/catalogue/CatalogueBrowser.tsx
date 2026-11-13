"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldInput } from "@/components/FieldInput";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import { matchesQuery } from "@/lib/persian";

interface Item {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  points: string[];
  say: string | null;
  imageId: number | null;
  /** Base units believed to be on the van, or null when nothing is known. */
  onVan: number | null;
  packs: { id: number; name: string; price: number | null }[];
}

function Picture({ id, size }: { id: number | null; size: "thumb" | "full" }) {
  if (id === null) return <div className="catalogue__noimg" aria-hidden="true"><Icon name="package" size="lg" /></div>;
  return <img className="catalogue__img" src={`/api/content-images/${id}/file${size === "thumb" ? "?size=thumb" : ""}`} alt="" loading="lazy" />;
}

export default function CatalogueBrowser({ items, asOf, hasVan }: { items: Item[]; asOf: string; hasVan: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [shown, setShown] = useState<Item | null>(null);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))], [items]);
  const list = items.filter((i) => (!cat || i.category === cat) && (!q.trim() || matchesQuery([i.name, i.category ?? "", i.points.join(" ")].join(" "), q)));

  return (
    <div className="catalogue" dir="rtl">
      <p className="acad__muted">قیمت‌ها تا {faJalaliDateTime(asOf)}{hasVan ? ". موجودی ماشین تقریبی است." : ""}</p>
      <FieldInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی کالا…" aria-label="جستجوی کالا" />
      {categories.length > 0 && (
        <ChipGroup wrap group={{
          id: "cat", label: "گروه کالا", mode: "single", value: cat,
          options: categories.map((c) => ({ id: c, label: c })), onChange: (v) => setCat(v as string),
        }} />
      )}
      <Link href="/print/price-list" className="btn ghost inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start">
        <Icon name="print" size="md" /> برگهٔ قیمت (چاپ یا ذخیره)
      </Link>
      {list.length === 0 ? (
        <p className="acad__muted">{items.length === 0 ? "هنوز کالایی با قیمت ثبت نشده است." : "کالایی با این جستجو پیدا نشد."}</p>
      ) : (
        <ul className="catalogue__list">
          {list.map((i) => (
            <li key={i.id} className="catalogue__card">
              <Picture id={i.imageId} size="thumb" />
              <div className="catalogue__body">
                <h3>{i.name}</h3>
                <ul className="catalogue__packs">
                  {i.packs.map((k) => (
                    <li key={k.id}><span>{k.name}</span><b>{k.price === null ? "بدون قیمت" : faToman(k.price)}</b></li>
                  ))}
                </ul>
                {i.onVan !== null && <p className="acad__muted">روی ماشین: حدود {faNum(Math.max(0, Math.round(i.onVan)))} {i.unit}</p>}
                {i.points.length > 0 && <ul className="catalogue__points">{i.points.map((p, n) => <li key={n}>{p}</li>)}</ul>}
                {i.say && <p className="catalogue__say">«{i.say}»</p>}
                <button type="button" className="btn ghost inline-flex min-h-[44px] items-center gap-[var(--space-2)]" onClick={() => setShown(i)}>
                  <Icon name="maximize" size="md" /> نمایش به مشتری
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={shown !== null} onClose={() => setShown(null)} title={shown?.name ?? ""} closeLabel="بستن نمایش به مشتری" expandable>
        {shown && (
          <div className="catalogue__show" dir="rtl">
            <Picture id={shown.imageId} size="full" />
            <ul className="catalogue__packs catalogue__packs--big">
              {shown.packs.map((k) => (
                <li key={k.id}><span>{k.name}</span><b>{k.price === null ? "بدون قیمت" : faToman(k.price)}</b></li>
              ))}
            </ul>
            {shown.points.length > 0 && <ul className="catalogue__points">{shown.points.map((p, n) => <li key={n}>{p}</li>)}</ul>}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
