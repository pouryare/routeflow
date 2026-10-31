"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import type { RunDetail, RunStop } from "@/lib/delivery";
import { faToman, faNum } from "@/lib/format";
import { flush, queueSize, sendDelivery, subscribe } from "@/lib/deliveryQueue";
import { buildReceipt } from "@/lib/deliveryReceipt";
import DeliveryFlow from "@/components/flows/DeliveryFlow";
import SwipeRow from "@/components/mobile/SwipeRow";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { useMyPosition } from "@/components/MyPositionProvider";
import { stopAtDoor } from "@/lib/arrival";
import ReceiptPrinter from "@/components/sales/ReceiptPrinter";
import type { ReceiptData } from "@/lib/receiptLayout";
import PriorityTag from "@/components/sales/PriorityTag";

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
  const [folded, setFolded] = useState(false);

  /* Arrival: when the driver is within 150 m of a pending stop, a one-line banner offers the
     delivery flow for exactly that stop (a banner, not a question). «فعلاً نه» hides it for
     that stop until the page is reloaded; the position watch is the app-wide one. */
  const { position } = useMyPosition();
  const [waved, setWaved] = useState<ReadonlySet<number>>(new Set());
  const [launch, setLaunch] = useState<{ id: number; n: number } | null>(null);
  const here = useMemo(() => (position ? { lat: position.lat, lng: position.lng } : null), [position]);
  const atDoor = useMemo(() => stopAtDoor(run.stops, here, waved), [run.stops, here, waved]);

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

      {atDoor && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--surface-raised)] p-[var(--space-3)]" role="status">
          <span className="min-w-0 flex-1 text-[length:var(--text-sm)] text-[var(--text)]">
            به <strong className="text-[var(--accent)]">{atDoor.customer_name}</strong> رسیدید
          </span>
          <button
            type="button"
            onClick={() => setLaunch((l) => ({ id: atDoor.id, n: (l?.n ?? 0) + 1 }))}
            className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-accent-ink"
          >
            <Icon name="check" size="md" />
            ثبت تحویل
          </button>
          <button
            type="button"
            onClick={() => setWaved((w) => new Set(w).add(atDoor.id))}
            className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
          >
            <Icon name="x" size="md" />
            فعلاً نه
          </button>
        </div>
      )}

      <ul className="flex list-none flex-col gap-[var(--space-2)] p-0">
        {run.stops.map((stop) => (
          <StopCard
            key={stop.id}
            launchN={launch?.id === stop.id ? launch.n : 0}
            stop={stop}
            open={openStop === stop.id}
            onToggle={() => setOpenStop(openStop === stop.id ? null : stop.id)}
            onRecorded={() => router.refresh()}
            onPrint={(data) => { setFolded(false); setReceipt(data); }}
            runDate={run.run_date}
            driverName={driverName}
            businessName={businessName}
            lastStop={run.stops.every((s) => s.id === stop.id || s.status !== "pending")}
          />
        ))}
      </ul>

      {receipt && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] flex items-center justify-between">
            <h2 className="m-0 text-[length:var(--text-base)] text-[var(--text)]">رسید</h2>
            <div className="flex gap-[var(--space-2)]">
              <button
                type="button"
                aria-expanded={!folded}
                onClick={() => setFolded((f) => !f)}
                className="touch rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]"
              >
                <Icon name={folded ? "chevron-down" : "minimize"} size="sm" />
                {folded ? "باز کردن رسید" : "تا کردن رسید"}
              </button>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="touch rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]"
              >
                <Icon name="x" size="sm" />
                بستن رسید
              </button>
            </div>
          </div>
          <div className="foldbill" data-folded={folded}>
            <div className="foldbill__inner">
              <ReceiptPrinter data={receipt} />
            </div>
          </div>
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
  launchN,
  open,
  onToggle,
  onRecorded,
  onPrint,
  runDate,
  driverName,
  businessName,
  lastStop,
}: {
  stop: RunStop;
  /** Bumped by the arrival banner to open this stop's delivery flow. */
  launchN: number;
  open: boolean;
  onToggle: () => void;
  onRecorded: () => void;
  onPrint: (data: ReceiptData) => void;
  runDate: string;
  driverName: string;
  businessName: string;
  lastStop: boolean;
}) {
  /* The flow remounts per opening (the `key`), which is what gives each visit a fresh set of
   * questions; `flowOpen` only slides the sheet in and out. */
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowKey, setFlowKey] = useState(0);
  const done = stop.status !== "pending";
  /* «بعداً»: a stop that cannot be done now goes to the end of the run (the server keeps it pending),
     held 5 s with undo. */
  const undoable = useUndoableAction();
  const defer = () =>
    undoable.run({
      message: `«${stop.customer_name}» به آخر مسیر رفت`,
      send: async () => {
        const res = await fetch(`/api/driver/stops/${stop.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "defer" }),
        });
        return res.ok ? { ok: true } : { ok: false };
      },
      failure: "توقف جابه‌جا نشد؛ دوباره تلاش کنید",
      onDone: onRecorded,
    });
  /* The arrival banner asks for this stop's flow by bumping `launchN`; adjusting state while
     rendering (not in an effect) opens it once per bump. */
  const [seenLaunch, setSeenLaunch] = useState(0);
  if (launchN !== 0 && launchN !== seenLaunch) {
    setSeenLaunch(launchN);
    setFlowKey((k) => k + 1);
    setFlowOpen(true);
  }
  const startFlow = () => {
    setFlowKey((k) => k + 1);
    setFlowOpen(true);
  };

  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
      <SwipeRow
        ownButtons={false}
        start={done ? undefined : { label: "ثبت تحویل", icon: "check", run: startFlow }}
        end={done ? undefined : { label: "بعداً این توقف", icon: "arrow-left", run: defer }}
      >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center justify-center gap-[var(--space-2)] flex w-full items-start justify-between gap-[var(--space-3)] p-[var(--space-4)] text-right"
      >
        <Icon name="check" size="md" />
        <span className="min-w-0">
          <span className="flex items-center gap-[var(--space-2)] truncate text-[length:var(--text-base)] text-[var(--text)]">
            {stop.customer_name}
            <PriorityTag priority={stop.priority} />
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
              className="mb-[var(--space-3)] inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--accent)] no-underline"
            >
              <Icon name="phone" size="sm" />
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
            {!done && (
              <button
                type="button"
                onClick={defer}
                className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
              >
                <Icon name="clock" size="md" />
                بعداً این توقف
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
          lastStop={lastStop}
        />
      )}
    </li>
  );
}
