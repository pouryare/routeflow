"use client";

import { useEffect, useState } from "react";
import { faToman, faNum } from "@/lib/format";

export interface ProductPack {
  id: number;
  name: string;
  qty_per_pack: number;
  price_toman: number | null;
}
export interface ProductRow {
  id: number;
  name: string;
  base_unit: string;
  kg_per_base_unit: number;
  active: number;
  packagings: ProductPack[];
}

const KEY = "meridian-products-view";

/** The catalogue, in either of two readings — and the reader chooses.
 *
 *  فهرست is the dense one: every packaging of a product on its own row, priced, sortable
 *  by eye down a column. کاشی is the scannable one: each packaging a tile with the price
 *  as the loudest thing on it, which is what you want when you are reading prices off a
 *  screen at arm's length rather than comparing them.
 *
 *  The choice is remembered per browser. A view toggle that resets on every visit makes
 *  the reader re-choose a preference they already have.
 */
export default function ProductsView({ products }: { products: ProductRow[] }) {
  const [view, setView] = useState<"list" | "tiles">("list");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Browser-only read: localStorage does not exist during the server render, so this
      // cannot move into useState's initialiser without a hydration mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "tiles" || saved === "list") setView(saved);
    } catch {
      // Private-window storage denial. The default view is still correct.
    }
  }, []);

  function choose(v: "list" | "tiles") {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* see above */
    }
  }

  return (
    <>
      <div className="viewbar">
        <div className="viewbar__seg" role="group" aria-label="نحوهٔ نمایش">
          <button
            type="button"
            className={view === "list" ? "on" : ""}
            aria-pressed={view === "list"}
            onClick={() => choose("list")}
          >
            ▤ فهرست
          </button>
          <button
            type="button"
            className={view === "tiles" ? "on" : ""}
            aria-pressed={view === "tiles"}
            onClick={() => choose("tiles")}
          >
            ▦ کاشی
          </button>
        </div>
        <span className="viewbar__n">{faNum(products.length)} کالا</span>
      </div>

      {view === "list" ? (
        <>
          <div className="pk pk--head" aria-hidden>
            <span>بسته‌بندی</span>
            <span className="pk__q">تعداد</span>
            <span className="pk__w">وزن</span>
            <span className="pk__k">نرخ هر کیلو</span>
            <span className="pk__p">قیمت</span>
          </div>
          <ul className="plist">
            {products.map((p) => (
              <li className="prow" key={p.id}>
                <div className="prow__head">
                  <h2>
                    {p.name}
                    {p.active === 0 && <span className="off">غیرفعال</span>}
                  </h2>
                  <span className="prow__unit mono">
                    هر {p.base_unit} = {faNum(p.kg_per_base_unit)} کیلوگرم
                  </span>
                </div>

                {p.packagings.length === 0 ? (
                  <p className="prow__none">بسته‌بندی ندارد — تا وقتی اضافه نشود قابل فروش نیست.</p>
                ) : (
                  <div className="prow__packs">
                    {p.packagings.map((k) => {
                      const kg = k.qty_per_pack * p.kg_per_base_unit;
                      const perKg = k.price_toman !== null && kg > 0 ? Math.round(k.price_toman / kg) : null;
                      return (
                        <div className="pk" key={k.id}>
                          <span className="pk__n">{k.name}</span>
                          <span className="pk__q mono">
                            {faNum(k.qty_per_pack)} {p.base_unit}
                          </span>
                          <span className="pk__w mono">{faNum(Math.round(kg * 100) / 100)} کیلو</span>
                          <span className="pk__k mono">{perKg === null ? "—" : faToman(perKg)}</span>
                          <span className="pk__p">
                            {k.price_toman === null ? (
                              <span className="np">
                                <i />
                                قیمت ندارد
                              </span>
                            ) : (
                              <span className="mono">{faToman(k.price_toman)}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        /* Multi-column, and flat: each weight is its own product in this catalogue, so
           tiles do not need to be grouped under a parent — grouping would put a heading
           above a single tile most of the time. */
        <div className="ptiles">
          {products.flatMap((p) =>
            (p.packagings.length ? p.packagings : [null]).map((k, i) => (
              <div className={`ptile${p.active === 0 ? " ptile--off" : ""}`} key={`${p.id}-${k?.id ?? i}`}>
                <div className="ptile__name">
                  {p.name}
                  {p.active === 0 && <span className="off">غیرفعال</span>}
                </div>
                <div className="ptile__price">
                  {k === null || k.price_toman === null ? (
                    <span className="np">
                      <i />
                      قیمت ندارد
                    </span>
                  ) : (
                    <>
                      <span className="mono">{faNum(k.price_toman)}</span>
                      <small>تومان</small>
                    </>
                  )}
                </div>
                <div className="ptile__meta">
                  {k === null ? (
                    "بسته‌بندی ندارد"
                  ) : (
                    <>
                      <span>{k.name}</span>
                      <span className="mono">
                        {faNum(Math.round(k.qty_per_pack * p.kg_per_base_unit * 100) / 100)} کیلو
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
