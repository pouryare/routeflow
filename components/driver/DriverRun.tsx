"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import type { RunDetail, RunStop } from "@/lib/delivery";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { roundToman, toToman } from "@/lib/money";
import { enqueue, dequeue, flush, queueSize, subscribe } from "@/lib/deliveryQueue";
import ReceiptPrinter from "@/components/sales/ReceiptPrinter";
import type { ReceiptData } from "@/lib/receiptLayout";

/** Split so the quantity box can be narrow. FIELD carries w-full, and a later w-24 in
 *  the class string does not beat it -- Tailwind resolves by CSS order, not by the
 *  order the classes are written, so the two collided and the row overlapped. */
const FIELD_BASE =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-base)] tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]";
const FIELD = `w-full ${FIELD_BASE}`;

/** Online status as an external store rather than effect state.
 *
 *  It is not React's to own -- the browser fires online/offline and navigator.onLine is
 *  the truth. The effect version also carried a real bug: each removeEventListener was
 *  handed a freshly created arrow function, so the offline listener was never removed.
 */
const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

function send(stopId: number, body: unknown) {
  return fetch(`/api/driver/stops/${stopId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The round, one stop at a time.
 *
 *  Built for a phone held in one hand at a doorstep. The quantities default to what was
 *  ordered, so the common case -- everything handed over -- is one tap; adjusting is for
 *  the exception.
 *
 *  Recording never blocks on the network. The delivery has already happened by the time
 *  the driver types it, so a weak signal must not be able to lose it: the write is
 *  queued locally and sent when it can be, and retried safely because recording a
 *  delivery is a set of assignments rather than increments.
 */
export default function DriverRun({
  run,
  driverName,
  businessName,
}: {
  run: RunDetail;
  driverName: string;
  businessName: string;
}) {
  const router = useRouter();
  const [openStop, setOpenStop] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  // Both read through useSyncExternalStore: they are external state, and setting them
  // from an effect would cost an extra render pass every time the signal flickers.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const pending = useSyncExternalStore(subscribe, queueSize, () => 0);

  useEffect(() => {
    // Flush when the connection is up, including once on mount -- the phone may have
    // regained signal while the app was closed.
    if (!online) return;
    let cancelled = false;
    void flush(send).then(({ sent }) => {
      if (sent > 0 && !cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [online, router]);

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="grid grid-cols-3 gap-[var(--space-2)]">
        <Tile label="باقی‌مانده" value={faNum(run.remaining)} />
        <Tile label="دریافتی امروز" value={faToman(run.collected_toman)} />
        <Tile label="مانده وصول" value={faToman(run.to_collect_toman)} />
      </div>

      {(!online || pending > 0) && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-3)] text-[length:var(--text-xs)] leading-5 text-[var(--warn)]">
          {online
            ? `${faNum(pending)} تحویل هنوز ارسال نشده — به‌محض وصل شدن خودکار ارسال می‌شود.`
            : "اینترنت قطع است. تحویل‌ها ذخیره می‌شوند و بعداً خودکار ارسال می‌شوند."}
        </p>
      )}

      <ul className="flex list-none flex-col gap-[var(--space-2)] p-0">
        {run.stops.map((stop) => (
          <StopCard
            key={stop.id}
            stop={stop}
            open={openStop === stop.id}
            onToggle={() => setOpenStop(openStop === stop.id ? null : stop.id)}
            onRecorded={() => router.refresh()}
            onPrint={(data) => setReceipt(data)}
            runDate={run.run_date}
            driverName={driverName}
            businessName={businessName}
          />
        ))}
      </ul>

      {receipt && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] flex items-center justify-between">
            <h2 className="m-0 text-[length:var(--text-base)] text-[var(--text)]">رسید</h2>
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]"
            >
              <Icon name="x" size="sm" />
              بستن رسید
            </button>
          </div>
          <ReceiptPrinter data={receipt} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] text-center">
      <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</span>
      <strong className="mt-[var(--space-1)] block text-[length:var(--text-base)] font-medium tabular-nums text-[var(--text)]">
        {value}
      </strong>
    </div>
  );
}

function StopCard({
  stop,
  open,
  onToggle,
  onRecorded,
  onPrint,
  runDate,
  driverName,
  businessName,
}: {
  stop: RunStop;
  open: boolean;
  onToggle: () => void;
  onRecorded: () => void;
  onPrint: (data: ReceiptData) => void;
  runDate: string;
  driverName: string;
  businessName: string;
}) {
  // Defaults to what was ordered: everything handed over is the common case, so it
  // should need no typing at all.
  const [packs, setPacks] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      stop.lines.map((l) => [l.id, String(l.packs_delivered ?? l.packs_ordered)])
    )
  );
  const [collected, setCollected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delivered = stop.lines.map((line) => ({
    line,
    packs: Number(packs[line.id] ?? 0),
  }));
  const total = delivered.reduce(
    (sum, d) => sum + roundToman((Number.isFinite(d.packs) ? d.packs : 0) * d.line.unit_price_toman),
    0
  );
  const collectedToman = collected.trim() === "" ? total : (toToman(collected) ?? 0);
  const done = stop.status !== "pending";

  function receiptFor(collectedNow: number): ReceiptData {
    return {
      businessName,
      orderNo: stop.order_no,
      dateLabel: faJalaliDate(runDate),
      customerName: stop.customer_name,
      address: stop.address,
      phone: stop.phone,
      lines: delivered
        .filter((d) => d.packs > 0)
        .map((d) => ({
          name: `${d.line.product_name} · ${d.line.packaging_name}`,
          detail: `${faNum(d.packs)} بسته × ${faToman(d.line.unit_price_toman)}`,
          amount: faToman(roundToman(d.packs * d.line.unit_price_toman)),
        })),
      totalLabel: faToman(total),
      paidLabel: faToman(collectedNow),
      dueLabel: collectedNow < total ? faToman(total - collectedNow) : null,
      driverName,
      footer: "با تشکر از خرید شما",
    };
  }

  async function record() {
    setBusy(true);
    setError(null);
    const body = {
      lines: delivered.map((d) => ({ line_id: d.line.id, packs_delivered: d.packs })),
      collected_toman: collectedToman,
    };

    // Queued first, then sent. If the request never completes -- no signal, the phone
    // sleeping, the app closing -- the record of a delivery that already happened
    // survives on the device rather than being lost between the two.
    enqueue({ stopId: stop.id, body, recordedAt: new Date().toISOString() });

    try {
      const res = await send(stop.id, body);
      if (res.ok) {
        dequeue(stop.id);
      } else if (res.status >= 400 && res.status < 500) {
        dequeue(stop.id);
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "تحویل ثبت نشد. اطلاعات را بررسی کنید و دوباره تلاش کنید.");
        return;
      }
    } catch {
      // Stays queued. Nothing to tell the driver beyond the banner already showing.
    } finally {
      setBusy(false);
    }

    onPrint(receiptFor(collectedToman));
    onRecorded();
  }

  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center justify-center gap-[var(--space-2)] flex w-full items-start justify-between gap-[var(--space-3)] p-[var(--space-4)] text-right"
      >
        <Icon name="check" size="md" />
        <span className="min-w-0">
          <span className="block truncate text-[length:var(--text-base)] text-[var(--text)]">
            {stop.customer_name}
          </span>
          <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {stop.address ?? "بدون آدرس"}
          </span>
        </span>
        <span className="shrink-0 text-left">
          <span className="block tabular-nums text-[length:var(--text-sm)] text-[var(--text)]">
            {faToman(stop.total_toman)}
          </span>
          <span
            className="mt-[var(--space-1)] block text-[length:var(--text-xs)]"
            style={{
              color:
                stop.status === "delivered"
                  ? "var(--good)"
                  : stop.status === "refused"
                    ? "var(--crit)"
                    : "var(--text-faint)",
            }}
          >
            {stop.status === "delivered"
              ? "تحویل شد"
              : stop.status === "refused"
                ? "برگشت خورد"
                : "در انتظار"}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--border)] p-[var(--space-4)]">
          {stop.phone && (
            <a
              href={`tel:${stop.phone}`}
              className="mb-[var(--space-3)] inline-block rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--accent)] no-underline"
            >
              تماس با مشتری
            </a>
          )}

          <ul className="flex list-none flex-col gap-[var(--space-3)] p-0">
            {stop.lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-[var(--space-3)]">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--text-sm)] text-[var(--text)]">
                    {line.product_name}
                  </span>
                  <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-faint)]">
                    {line.packaging_name} · سفارش {faNum(line.packs_ordered)} بسته
                  </span>
                </div>
                <input
                  aria-label={`تعداد تحویل ${line.product_name}`}
                  className={`${FIELD_BASE} w-20 shrink-0 text-center`}
                  value={packs[line.id] ?? ""}
                  onChange={(e) => setPacks((p) => ({ ...p, [line.id]: e.target.value }))}
                  inputMode="decimal"
                  disabled={done}
                />
              </li>
            ))}
          </ul>

          <div className="mt-[var(--space-4)] flex items-end gap-[var(--space-3)]">
            <div className="flex-1">
              <label className="mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                دریافتی (تومان)
              </label>
              <input
                className={FIELD}
                value={collected}
                onChange={(e) => setCollected(e.target.value)}
                inputMode="numeric"
                placeholder={faToman(total)}
                disabled={done}
              />
            </div>
            <div className="text-left">
              <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                جمع تحویل
              </span>
              <strong className="block tabular-nums text-[length:var(--text-base)] text-[var(--text)]">
                {faToman(total)}
              </strong>
            </div>
          </div>

          {error && (
            <p className="mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--crit)]">
              {error}
            </p>
          )}

          <div className="mt-[var(--space-4)] flex gap-[var(--space-2)]">
            {!done && (
              <button
                type="button"
                onClick={record}
                disabled={busy}
                className="inline-flex items-center justify-center gap-[var(--space-2)] flex-1 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium text-accent-ink disabled:opacity-50"
              >
                <Icon name="check" size="md" />
                {busy ? "در حال ثبت تحویل…" : "ثبت تحویل و چاپ رسید"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onPrint(receiptFor(stop.collected_toman || total))}
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
            >
              <Icon name="receipt" size="sm" />
              نمایش رسید
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
