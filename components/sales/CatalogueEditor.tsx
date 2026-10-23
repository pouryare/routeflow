"use client";

import { usePostAction } from "@/lib/usePostAction";
import { tehranTodayIso } from "@/lib/jalali";
import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { toToman } from "@/lib/money";
import { faToman } from "@/lib/format";
import MarginHelperDrawer, { type DrawerProduct } from "./MarginHelperDrawer";
import SmartPicker from "@/components/mobile/SmartPicker";
import { ChipGroup } from "@/components/mobile/ChipGroup";

interface ProductOption {
  id: number;
  name: string;
  base_unit: string;
  kg_per_base_unit: number;
  avg_cost_toman: number;
  /** What the effective-dated resolver returned, or 0 when it returned null. */
  cost_toman: number;
  /** null means "no cost recorded", which is NOT the same as a cost of zero. */
  cost_method: "weighted_average" | "landed" | null;
  packagings: { id: number; name: string; price_toman: number | null }[];
}

const FIELD =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--accent)]";
const LABEL = "mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]";
const BUTTON =
  "rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] hover:brightness-110 active:scale-[0.98] disabled:opacity-50";

/** Owner-only controls for the catalogue.
 *
 *  Three separate forms rather than one wizard: adding a product, giving it a packaging
 *  and setting a price are three different moments. The catalogue gets finished in one
 *  sitting, but prices change for years afterwards, and a price form buried at step
 *  three of a product wizard would be the wrong shape for the thing that happens most.
 */
export default function CatalogueEditor({
  products,
  companyRatePerKg,
}: {
  products: ProductOption[];
  /** The company per-kg commission rate in force, so the drawer need not ask for it. */
  companyRatePerKg: number | null;
}) {
  const { busy, message, send } = usePostAction("تغییر کالا ثبت نشد؛ دوباره تلاش کنید");

  // --- product ---
  const [pName, setPName] = useState("");
  const [pUnit, setPUnit] = useState("عدد");
  const [pKg, setPKg] = useState("");

  // --- packaging ---
  const [kProduct, setKProduct] = useState("");
  const [kName, setKName] = useState("");
  const [kQty, setKQty] = useState("");

  // --- price ---
  const [rProduct, setRProduct] = useState("");
  const [rPackaging, setRPackaging] = useState("");
  const [rPrice, setRPrice] = useState("");
  const [rFrom, setRFrom] = useState(() => tehranTodayIso());

  const parsedPrice = toToman(rPrice);
  const packagingsOf = products.find((p) => String(p.id) === rProduct)?.packagings ?? [];

  return (
    <section className="flex flex-col gap-[var(--space-4)] card p-[var(--space-4)]">
      <h2 className="sechead__title">
        افزودن و قیمت‌گذاری
      </h2>

      {message && (
        <p
          className={`m-0 text-[length:var(--text-sm)] ${
            message.kind === "ok" ? "text-[var(--good)]" : "text-[var(--crit)]"
          }`}
        >
          {message.text}
        </p>
      )}

      <form
        className="grid gap-[var(--space-3)] md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await send(
            "/api/sales/products",
            { name: pName, base_unit: pUnit, kg_per_base_unit: Number(pKg) },
            "کالا اضافه شد"
          );
          if (ok) {
            setPName("");
            setPKg("");
          }
        }}
      >
        <div className="md:col-span-2">
          <label className={LABEL} htmlFor="p-name">
            نام کالا
          </label>
          <input
            id="p-name"
            className={FIELD}
            value={pName}
            onChange={(e) => setPName(e.target.value)}
            placeholder="دوغ لیوانی"
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="p-unit">
            واحد
          </label>
          <input
            id="p-unit"
            className={FIELD}
            value={pUnit}
            onChange={(e) => setPUnit(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="p-kg">
            کیلوگرم در هر واحد
          </label>
          <input
            id="p-kg"
            className={FIELD}
            value={pKg}
            onChange={(e) => setPKg(e.target.value)}
            inputMode="decimal"
            placeholder="۰٫۲۵"
            required
          />
        </div>
        <div className="md:col-span-4">
          <button className={BUTTON} disabled={busy} type="submit">
            <Icon name="plus" size="md" />
            افزودن کالا
          </button>
        </div>
      </form>

      <hr className="border-0 border-t border-[var(--border)]" />

      <form
        className="grid gap-[var(--space-3)] md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await send(
            "/api/sales/packagings",
            { product_id: Number(kProduct), name: kName, qty_per_pack: Number(kQty) },
            "بسته‌بندی اضافه شد"
          );
          if (ok) {
            setKName("");
            setKQty("");
          }
        }}
      >
        <div className="md:col-span-2">
          <span className={LABEL}>
            کالا
          </span>
          <SmartPicker
            scope="products"
            label="کالا"
            items={products.map((p) => ({ id: String(p.id), label: p.name }))}
            value={kProduct}
            onChange={setKProduct}
            placeholder="انتخاب کنید…"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="k-name">
            نام بسته‌بندی
          </label>
          <input
            id="k-name"
            className={FIELD}
            value={kName}
            onChange={(e) => setKName(e.target.value)}
            placeholder="جعبه بچه"
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="k-qty">
            تعداد در بسته
          </label>
          <input
            id="k-qty"
            className={FIELD}
            value={kQty}
            onChange={(e) => setKQty(e.target.value)}
            inputMode="decimal"
            placeholder="۱۲۰"
            required
          />
        </div>
        <div className="md:col-span-4">
          <button className={BUTTON} disabled={busy} type="submit">
            <Icon name="plus" size="md" />
            افزودن بسته‌بندی
          </button>
        </div>
      </form>

      <hr className="border-0 border-t border-[var(--border)]" />

      <form
        className="grid gap-[var(--space-3)] md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (parsedPrice === null) return;
          const ok = await send(
            "/api/sales/prices",
            {
              product_id: Number(rProduct),
              packaging_id: rPackaging === "" ? null : Number(rPackaging),
              price_toman: parsedPrice,
              valid_from: rFrom,
            },
            "قیمت تازه ثبت شد"
          );
          if (ok) setRPrice("");
        }}
      >
        <div>
          <span className={LABEL}>
            کالا
          </span>
          <SmartPicker
            scope="products"
            label="کالا"
            items={products.map((p) => ({ id: String(p.id), label: p.name }))}
            value={rProduct}
            onChange={(id) => {
              setRProduct(id);
              setRPackaging("");
            }}
            placeholder="انتخاب کنید…"
          />
        </div>
        <div>
          <span className={LABEL}>
            بسته‌بندی
          </span>
          <ChipGroup
            wrap
            group={{ id: "r-packaging", label: "بسته‌بندی", mode: "single", value: rPackaging, onChange: (v) => setRPackaging(v as string),
              options: [{ id: "", label: "همه بسته‌بندی‌ها" }, ...packagingsOf.map((k) => ({ id: String(k.id), label: k.name }))] }}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="r-price">
            قیمت (تومان)
          </label>
          <input
            id="r-price"
            className={FIELD}
            value={rPrice}
            onChange={(e) => setRPrice(e.target.value)}
            inputMode="numeric"
            placeholder="۴۴۰۰۰۰"
            required
          />
          {rPrice !== "" && (
            <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {parsedPrice === null ? "عدد معتبر نیست" : faToman(parsedPrice)}
            </span>
          )}
        </div>
        <JalaliDatePicker id="r-from" label="از تاریخ" value={rFrom} onChange={setRFrom} />

        {/* Stacked on a phone, inline once there is room: at 430px the hint wrapped
            around the button and the two collided. */}
        <div className="flex flex-col items-start gap-[var(--space-2)] md:col-span-4 md:flex-row md:items-center md:gap-[var(--space-3)]">
          <button className={BUTTON} disabled={busy || parsedPrice === null} type="submit">
            <Icon name="check" size="md" />
            ثبت قیمت
          </button>
          <span className="text-[length:var(--text-xs)] leading-5 text-[var(--text-muted)]">
            قیمت قبلی پاک نمی‌شود؛ سفارش‌های گذشته با قیمت خودشان می‌مانند.
          </span>
        </div>
      </form>

      {/* The margin helper, folded directly under the price field it explains.
          It NEVER writes a price: `POST /api/sales/prices` stays the only way a price
          enters the system, so there is one path to price history and the owner still
          submits through the button above. What it READS is the same `product_costs`
          the order line snapshots, so the margin it shows is the margin that gets
          booked -- see `snapshotLine()` in lib/orders.ts. */}
      <MarginHelperDrawer
        products={products as DrawerProduct[]}
        selectedProductId={rProduct}
        selectedPackagingId={rPackaging}
        price={rPrice}
        companyRatePerKg={companyRatePerKg}
        onSelectProduct={(id) => {
          setRProduct(id);
          setRPackaging("");
        }}
        onSelectPackaging={setRPackaging}
      />
    </section>
  );
}
