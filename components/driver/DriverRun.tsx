"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import type { RunDetail, RunStop } from "@/lib/delivery";
import { faToman, faNum } from "@/lib/format";
import { flush, queueSize, sendDelivery, subscribe } from "@/lib/deliveryQueue";
import { buildReceipt } from "@/lib/deliveryReceipt";
import DeliveryFlow from "@/components/flows/DeliveryFlow";
import SwipeRow from "@/components/mobile/SwipeRow";
import ReceiptPrinter from "@/components/sales/ReceiptPrinter";
import type { ReceiptData } from "@/lib/receiptLayout";

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

/** The round, one stop at a time.
 *
 *  Built for a phone held in one hand at a doorstep. Recording a stop opens the delivery
 *  tap flow (components/flows/DeliveryFlow.tsx): everything handed over and the full amount
 *  collected is two taps; a shortfall asks only about the lines that were short.
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
    void flush(sendDelivery).then(({ sent }) => {
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
  /* The flow remounts per opening (the `key`), which is what gives each visit a fresh set of
   * questions; `flowOpen` only slides the sheet in and out. */
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowKey, setFlowKey] = useState(0);
  const done = stop.status !== "pending";
  const startFlow = () => {
    setFlowKey((k) => k + 1);
    setFlowOpen(true);
  };

  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
      <SwipeRow ownButtons={false} start={done ? undefined : { label: "ثبت تحویل", icon: "check", run: startFlow }}>
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
      </SwipeRow>

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
                {done && (
                  <span className="shrink-0 tabular-nums text-[length:var(--text-sm)] text-[var(--text)]">
                    تحویل {faNum(line.packs_delivered ?? line.packs_ordered)}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-[var(--space-4)] flex items-end justify-between">
            <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {done ? "دریافتی" : "جمع سفارش"}
            </span>
            <strong className="block tabular-nums text-[length:var(--text-base)] text-[var(--text)]">
              {faToman(done ? stop.collected_toman : stop.total_toman)}
            </strong>
          </div>

          <div className="mt-[var(--space-4)] flex gap-[var(--space-2)]">
            {!done && (
              <button
                type="button"
                onClick={startFlow}
                className="inline-flex items-center justify-center gap-[var(--space-2)] flex-1 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium text-accent-ink"
              >
                <Icon name="check" size="md" />
                ثبت تحویل این مشتری
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onPrint(
                  buildReceipt({
                    stop,
                    packs: Object.fromEntries(
                      stop.lines.map((l) => [l.id, l.packs_delivered ?? l.packs_ordered]),
                    ),
                    collectedToman: stop.collected_toman,
                    runDate,
                    driverName,
                    businessName,
                  }),
                )
              }
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
            >
              <Icon name="receipt" size="sm" />
              نمایش رسید
            </button>
          </div>
        </div>
      )}

      {flowKey > 0 && (
        <DeliveryFlow
          key={flowKey}
          open={flowOpen}
          stop={stop}
          runDate={runDate}
          driverName={driverName}
          businessName={businessName}
          onRecorded={onRecorded}
          onPrint={onPrint}
          onClose={() => setFlowOpen(false)}
          onReopen={() => setFlowOpen(true)}
        />
      )}
    </li>
  );
}
