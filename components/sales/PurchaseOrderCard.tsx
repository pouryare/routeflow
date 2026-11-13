"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon, type IconName } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faDigits, faNum, faToman } from "@/lib/format";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import { toNumber } from "@/lib/money";
import { PO_ACTIONS, PO_LABEL, PO_OPEN, remaining } from "@/lib/purchaseOrders";
import type { PoRow } from "@/lib/repo/purchaseOrders";

const ACTION: Record<"send" | "cancel" | "close", { label: string; icon: IconName }> = {
  send: { label: "ارسال به تأمین‌کننده", icon: "send" },
  cancel: { label: "لغو سفارش", icon: "x" },
  close: { label: "بستن با کسری", icon: "archive" },
};

/** F66: one purchase order: who, when it should arrive, what is still missing, and what the owner may do with it.
 *  «دریافت» opens a sheet with the quantity still missing on each line; saving makes the ordinary purchase receipt
 *  (stock, average cost, payable) and counts it off this order. */
export default function PurchaseOrderCard({ order }: { order: PoRow }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [got, setGot] = useState<Record<number, string>>({});
  const [invoice, setInvoice] = useState("");
  const open = PO_OPEN.includes(order.status);

  async function act(action: "send" | "cancel" | "close") {
    setBusy(true); setError(null);
    const res = await fetch(`/api/sales/purchase-orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }

  async function receive() {
    const lines = order.lines
      .map((l) => ({ product_id: l.product_id, base_qty: toNumber(got[l.id] ?? String(remaining(l))) ?? 0, unit_cost_toman: l.unit_cost_toman }))
      .filter((l) => l.base_qty > 0);
    if (lines.length === 0) { setError("تعداد رسیده را وارد کنید"); return; }
    setBusy(true); setError(null);
    const res = await fetch("/api/sales/purchases", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ purchase_order_id: order.id, purchase_date: tehranTodayIso(), invoice_no: invoice, lines }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { idem.renew(); setReceiving(false); router.refresh(); }
    else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="card mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" data-tour="purchase-order">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/accounting/suppliers/${order.supplier_id}`} className="font-medium text-[var(--accent-text)]">{order.supplier_name}</Link>
        <span className="text-[length:var(--text-sm)]" style={order.late ? { color: "var(--danger)" } : undefined}>
          {order.late ? "دیر شده · " : ""}{PO_LABEL[order.status]}
        </span>
      </div>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        {order.expected_date ? `انتظار رسیدن: ${faJalaliDate(order.expected_date)}` : "بدون تاریخ رسیدن"}{order.total_toman > 0 ? ` · ${faToman(order.total_toman)}` : ""}
      </p>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
        {order.lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-2">
            <span>{l.product_name}</span>
            <span className="tnum">{faNum(Math.min(l.received_qty, l.base_qty))} از {faNum(l.base_qty)}</span>
          </li>
        ))}
      </ul>
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {open ? (
          <button type="button" disabled={busy} onClick={() => { setReceiving(true); setError(null); }} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-3)] text-[length:var(--text-sm)]">
            <Icon name="download" size="md" /> دریافت کالا
          </button>
        ) : null}
        {PO_ACTIONS[order.status].map((a) => (
          <button key={a} type="button" disabled={busy} onClick={() => void act(a)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
            <Icon name={ACTION[a].icon} size="md" /> {ACTION[a].label}
          </button>
        ))}
      </div>
      <BottomSheet open={receiving} title="دریافت کالا" subtitle={order.supplier_name} onClose={() => setReceiving(false)} closeLabel="بستن فرم دریافت">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          {order.lines.filter((l) => remaining(l) > 0).map((l) => (
            <KeypadField key={l.id} label={`${l.product_name} · مانده ${faNum(remaining(l))}`} decimal value={got[l.id] ?? String(remaining(l))} onChange={(v) => setGot((g) => ({ ...g, [l.id]: v }))} />
          ))}
          <FieldInput value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="شمارهٔ فاکتور (اختیاری)" aria-label="شمارهٔ فاکتور" />
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">قیمت هر کالا همان قیمت سفارش است{order.lines.length ? ` (${faDigits("مثلاً")} ${faToman(order.lines[0].unit_cost_toman)})` : ""}. موجودی و بدهی به تأمین‌کننده با ثبت اضافه می‌شود.</p>
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="check" isDisabled={busy} onPress={() => void receive()}>ثبت دریافت</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}
