"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { splinePath, type Pt } from "@/lib/design/spline";
import { faNum, faToman } from "@/lib/format";
import { matchesQuery } from "@/lib/persian";
import { Icon } from "@/components/meridian/Icon";

export interface InventoryRow {
  product_id: number;
  name: string;
  base_unit: string;
  on_hand: number;
  value_toman: number;
  reorder_point: number | null;
  target_stock: number | null;
  status: "crit" | "low" | "ok" | "over";
  daily_rate: number;
  days_left: number | null;
  spark: number[];
  last_purchase_date: string | null;
}

const STATUS_LABEL = { crit: "بحرانی", low: "کم‌موجود", ok: "سالم", over: "مازاد" } as const;
const STATUS_TONE = { crit: "crit", low: "amber", ok: "sage", over: "sky" } as const;

const SPARK_W = 90;
const SPARK_H = 28;

function sparkGeometry(values: number[]) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = SPARK_W / (values.length - 1);
  // Oldest on the right -- this app's charts put index 0 there under RTL (see SalesSpark).
  const pts: Pt[] = values.map((v, i) => ({
    x: SPARK_W - i * step,
    y: SPARK_H - ((v - min) / span) * SPARK_H,
  }));
  return { d: splinePath(pts), last: pts[pts.length - 1] };
}

/** The advanced انبار board -- reorder gauges, delivery-velocity sparklines, and a
 *  days-to-stockout figure per product, plus a reorder-alert banner up top. Filtering
 *  and sorting happen in the browser: a real catalogue here is dozens of products, not
 *  thousands, so there is nothing a round trip to the server would buy.
 */
export default function InventoryBoard({ rows, canEdit }: { rows: InventoryRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "crit" | "low" | "ok" | "over">("all");
  const [sort, setSort] = useState<"days" | "value" | "name">("days");

  const counts = useMemo(() => {
    const c = { all: rows.length, crit: 0, low: 0, ok: 0, over: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const critical = useMemo(
    () =>
      rows
        .filter((r) => r.status === "crit")
        .sort((a, b) => (a.days_left ?? Infinity) - (b.days_left ?? Infinity)),
    [rows]
  );

  const visible = useMemo(() => {
    let list = rows.filter((r) => (filter === "all" || r.status === filter) && matchesQuery(r.name, q));
    list = [...list].sort((a, b) => {
      if (sort === "value") return b.value_toman - a.value_toman;
      if (sort === "name") return a.name.localeCompare(b.name, "fa");
      return (a.days_left ?? Infinity) - (b.days_left ?? Infinity);
    });
    return list;
  }, [rows, q, filter, sort]);

  return (
    <>
      {critical.length > 0 && (
        <div className="stalert">
          <div className="stalert__head">
            <Icon name="warn" size="sm" />
            <span className="mono">{faNum(critical.length)}</span>
            <span>کالا از نقطهٔ سفارش پایین‌تر رفته و منتظر خرید تازه‌اند</span>
          </div>
          <div className="stalert__rows">
            {critical.map((r) => {
              const suggestion =
                r.target_stock !== null
                  ? Math.max(0, Math.round(r.target_stock - r.on_hand))
                  : r.reorder_point !== null
                    ? Math.max(0, Math.round(r.reorder_point * 2 - r.on_hand))
                    : null;
              return (
                <div className="stalert__row" key={r.product_id}>
                  <span>
                    <b>{r.name}</b> ·{" "}
                    <span className="days mono">{r.days_left === null ? "نامشخص" : `${faNum(Math.round(r.days_left))} روز`}</span>{" "}
                    تا اتمام
                  </span>
                  {suggestion !== null && (
                    <span className="sug mono">
                      پیشنهاد: {faNum(suggestion)} {r.base_unit}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="sttoolbar">
        <label className="stsearch">
          <Icon name="search" size="sm" />
          <input type="text" placeholder="جست‌وجوی کالا…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="stchips" role="group" aria-label="فیلتر وضعیت">
          <button type="button" className="stchip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            همه · <b className="mono">{faNum(counts.all)}</b>
          </button>
          {(["crit", "low", "ok", "over"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="stchip"
              data-tone={STATUS_TONE[s]}
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              <i /> {STATUS_LABEL[s]} · <b className="mono">{faNum(counts[s])}</b>
            </button>
          ))}
        </div>
        <select className="stsort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="days">مرتب‌سازی: نزدیک‌ترین به اتمام</option>
          <option value="value">مرتب‌سازی: بیشترین ارزش</option>
          <option value="name">مرتب‌سازی: نام کالا</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
          کالایی با این جست‌وجو یا فیلتر پیدا نشد.
        </p>
      ) : (
        <div className="stgrid">
          {visible.map((r) => (
            <ProductCard key={r.product_id} row={r} canEdit={canEdit} onSaved={() => router.refresh()} />
          ))}
        </div>
      )}
    </>
  );
}

function ProductCard({ row: r, canEdit, onSaved }: { row: InventoryRow; canEdit: boolean; onSaved: () => void }) {
  // The gauge always has something sensible to scale against, even for a product the
  // owner has not configured yet -- otherwise an unset threshold would either divide by
  // zero or render a bar that is meaninglessly always full or always empty.
  const gaugeMax = r.target_stock ?? (r.reorder_point !== null ? r.reorder_point * 2 : Math.max(r.on_hand * 1.2, 1));
  const pct = Math.min(100, (r.on_hand / (gaugeMax * 1.15)) * 100);
  const reorderPct = r.reorder_point !== null ? Math.min(96, (r.reorder_point / (gaugeMax * 1.15)) * 100) : null;
  const spark = sparkGeometry(r.spark);
  const weeklyAvg = Math.round(r.daily_rate * 7);

  return (
    <article className="stcard">
      <div className="stcard__top">
        <div>
          <div className="stcard__name">{r.name}</div>
          {r.last_purchase_date && <div className="stcard__pack">آخرین خرید {r.last_purchase_date}</div>}
        </div>
        <span className="stpill" data-s={r.status}>
          <i /> {STATUS_LABEL[r.status]}
        </span>
      </div>

      <div className="stgauge">
        <div className="stgauge__row">
          <div className="stgauge__fill" data-s={r.status} style={{ width: `${pct}%` }} />
          {reorderPct !== null && (
            <div
              className="stgauge__tick"
              style={{ insetInlineStart: `${reorderPct}%` }}
              title={`نقطهٔ سفارش: ${faNum(r.reorder_point!)} ${r.base_unit}`}
            />
          )}
        </div>
        <div className="stgauge__labels">
          <span>
            موجودی <b className="mono">{faNum(Math.round(r.on_hand * 10) / 10)}</b> {r.base_unit}
          </span>
          <span>
            سقف هدف <b className="mono">{r.target_stock !== null ? faNum(r.target_stock) : "—"}</b>
          </span>
        </div>
      </div>

      <div className="stcard__mid">
        <div className="stcard__stat">
          <span className="k">تا اتمام</span>
          <span className={`v ${r.status === "crit" ? "crit" : r.status === "low" ? "amber" : ""}`}>
            {r.days_left === null ? "—" : `${faNum(Math.round(r.days_left))} روز`}
          </span>
        </div>
        <div className="stcard__stat">
          <span className="k">میانگین تحویل هفتگی</span>
          <span className="v">
            {faNum(weeklyAvg)} {r.base_unit}
          </span>
        </div>
        <div className="stspark" tabIndex={0}>
          <div className="tip">
            {faNum(Math.round(r.spark[r.spark.length - 1] * 10) / 10)} {r.base_unit}/روز
          </div>
          <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} role="img" aria-label="روند تحویل ۱۴ روز اخیر">
            <path d={spark.d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={spark.last.x} cy={spark.last.y} r={2.6} fill="var(--accent)" />
          </svg>
        </div>
      </div>

      <div className="stcard__foot">
        <span>ارزش موجودی</span>
        <span className="value">{faToman(r.value_toman)}</span>
      </div>

      <details className="stmore">
        <summary>جزئیات بیشتر</summary>
        <div className="stmore__body">
          <div className="stmore__row">
            <span>نقطهٔ سفارش</span>
            {canEdit ? (
              <ThresholdField productId={r.product_id} field="reorder_point" initial={r.reorder_point} onSaved={onSaved} />
            ) : (
              <b>{r.reorder_point !== null ? `${faNum(r.reorder_point)} ${r.base_unit}` : "تنظیم‌نشده"}</b>
            )}
          </div>
          <div className="stmore__row">
            <span>سقف هدف</span>
            {canEdit ? (
              <ThresholdField productId={r.product_id} field="target_stock" initial={r.target_stock} onSaved={onSaved} />
            ) : (
              <b>{r.target_stock !== null ? `${faNum(r.target_stock)} ${r.base_unit}` : "تنظیم‌نشده"}</b>
            )}
          </div>
        </div>
      </details>
    </article>
  );
}

/** One editable threshold. Its own small component because it owns its own draft value
 *  and save state -- lifting that into ProductCard would re-render the gauge and the
 *  sparkline on every keystroke in a field that only ever changes one number. */
function ThresholdField({
  productId,
  field,
  initial,
  onSaved,
}: {
  productId: number;
  field: "reorder_point" | "target_stock";
  initial: number | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== (initial === null ? "" : String(initial));

  async function save() {
    const n = value.trim() === "" ? null : Number(value);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/products/${productId}/stock-thresholds`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: n }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="تنظیم‌نشده"
      />
      {dirty ? (
        <button type="button" className="stmore__save" disabled={busy} onClick={save}>
          ثبت
        </button>
      ) : saved ? (
        <span className="stmore__saved">ثبت شد</span>
      ) : null}
    </span>
  );
}
