"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import type { OrderTransfer } from "@/lib/repo/orderTransfers";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";
const STATUS: Record<OrderTransfer["status"], string> = { pending: "منتظر جواب", accepted: "پذیرفته شد", refused: "رد شد" };

async function send(method: "POST" | "PATCH", body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/sales/order-transfers", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return null;
  const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
  return friendlyError(j.error, "انجام نشد؛ دوباره تلاش کنید");
}

/** F96 on the order page: ask another group to fulfil this confirmed order. */
export function TransferRequest({ orderId, groups }: { orderId: number; groups: { id: number; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={BTN} data-tour="order-transfer" onClick={() => setOpen(true)}><Icon name="arrow-swap" size="md" />درخواست تحویل توسط گروه دیگر</button>
      {open ? (
        <BottomSheet open title="تحویل توسط گروه دیگر" onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <ChipGroup wrap group={{ id: "transfer-group", label: "گروه", mode: "single", value: to, onChange: (v) => setTo(v as string), options: groups.map((g) => ({ id: String(g.id), label: g.name })) }} />
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">مدیر آن گروه جواب می‌دهد. اگر بپذیرد، سفارش روی مسیرهای او برنامه‌ریزی می‌شود؛ فروشنده و پورسانت همان می‌ماند.</p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="send" isDisabled={busy || !to} onPress={async () => { setBusy(true); const e = await send("POST", { order_id: orderId, to_group_id: Number(to) }); setBusy(false); if (e) setError(e); else { setOpen(false); router.refresh(); } }}>فرستادن درخواست</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}

/** F96 on the planning page: requests sent and received. The receiving manager accepts or refuses. */
export default function OrderTransfers({ transfers, myGroupIds }: { transfers: OrderTransfer[]; myGroupIds: number[] | "all" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = (g: number) => myGroupIds === "all" || myGroupIds.includes(g);
  if (transfers.length === 0) return null;
  async function answer(id: number, accept: boolean) {
    setBusy(true);
    setError(null);
    const e = await send("PATCH", { id, accept });
    setBusy(false);
    if (e) setError(e); else router.refresh();
  }
  return (
    <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" data-tour="order-transfers" aria-label="تحویل بین گروه‌ها">
      <b className="text-[length:var(--text-sm)]">تحویل بین گروه‌ها</b>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {transfers.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
            <span>سفارش {t.order_no} · از «{t.from_group}» به «{t.to_group}» · {STATUS[t.status]}</span>
            {t.status === "pending" && mine(t.to_group_id) ? (
              <span className="flex gap-[var(--space-2)]">
                <button type="button" className={BTN} disabled={busy} onClick={() => void answer(t.id, true)}><Icon name="check" size="md" />قبول</button>
                <button type="button" className={BTN} disabled={busy} onClick={() => void answer(t.id, false)}><Icon name="x" size="md" />رد</button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
    </section>
  );
}
