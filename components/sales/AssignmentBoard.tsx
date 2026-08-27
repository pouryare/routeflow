"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { useToast } from "@/components/ToastProvider";
import { Avatar } from "@/components/AvatarStack";

export interface BoardRun {
  id: number;
  run_date: string;
  status: string;
  driver_name: string;
  stop_count: number;
  remaining: number;
}

export interface BoardOrder {
  id: number;
  order_no: string;
  customer_name: string;
  total_toman: number;
  order_date: string;
}

/** Pixels of travel before a press becomes a drag. Below this it is a tap, and on a phone
 *  a finger never holds perfectly still -- without the threshold every tap on a card would
 *  start a drag and the card would never be selectable by touch at all. */
const DRAG_THRESHOLD = 6;

interface DragState {
  order: BoardOrder;
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
}

export default function AssignmentBoard({
  runs,
  orders,
}: {
  runs: BoardRun[];
  orders: BoardOrder[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverRun, setHoverRun] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ order: BoardOrder; runId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // Held in refs, not state: the pointer handlers run on every move and reading these
  // from state would close over whatever the values were when the listener was attached.
  const pending = useRef<{ order: BoardOrder; x: number; y: number; rect: DOMRect } | null>(null);
  const dragging = useRef(false);
  const hoverRef = useRef<number | null>(null);

  const openRuns = runs.filter((r) => r.status !== "done");

  const endDrag = useCallback(() => {
    pending.current = null;
    dragging.current = false;
    hoverRef.current = null;
    setDrag(null);
    setHoverRun(null);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pending.current;
      if (!p) return;

      if (!dragging.current) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (moved < DRAG_THRESHOLD) return;
        dragging.current = true;
        // Stops the browser treating the gesture as a scroll once it is a drag.
        document.body.style.userSelect = "none";
      }

      // elementFromPoint rather than cached rects: a column can scroll or reflow mid-drag,
      // and a cached rectangle would then be pointing at where the column used to be. The
      // ghost is pointer-events:none so it never occludes the target underneath it.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const col = el?.closest<HTMLElement>("[data-run-id]");
      const id = col ? Number(col.dataset.runId) : null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        setHoverRun(id);
      }

      setDrag({
        order: p.order,
        x: e.clientX,
        y: e.clientY,
        dx: p.x - p.rect.left,
        dy: p.y - p.rect.top,
        width: p.rect.width,
      });
    }

    function onUp() {
      if (dragging.current && pending.current) {
        const target = hoverRef.current;
        const order = pending.current.order;
        // A drop never writes. It proposes -- see MASTER.md "Assignment board". Dropping a
        // customer's delivery onto the wrong driver is not a mistake anyone notices until
        // the van is out, so the confirm step is the feature, not friction.
        if (target !== null) setConfirm({ order, runId: target });
      }
      document.body.style.userSelect = "";
      endDrag();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [endDrag]);

  function onPointerDown(e: React.PointerEvent, order: BoardOrder) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pending.current = {
      order,
      x: e.clientX,
      y: e.clientY,
      rect: e.currentTarget.getBoundingClientRect(),
    };
  }

  async function assign() {
    if (!confirm || confirm.runId === null) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/runs/${confirm.runId}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: confirm.order.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "افزودن به مسیر انجام نشد", "error");
        return;
      }
      toast(`سفارش ${confirm.order.order_no} به مسیر اضافه شد`, "success");
      setConfirm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const target = confirm?.runId != null ? runs.find((r) => r.id === confirm.runId) : null;

  return (
    <>
      <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ---- The pool ---- */}
        <section
          aria-labelledby="pool-heading"
          className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
        >
          <h2
            id="pool-heading"
            className="m-0 mb-[var(--space-1)] text-[length:var(--text-md)] font-medium text-[var(--text)]"
          >
            سفارش‌های بدون مسیر
          </h2>
          <p className="m-0 mb-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {faNum(orders.length)} سفارش · بکشید و روی یک مسیر رها کنید، یا با کلید Enter انتخاب کنید.
          </p>

          {orders.length === 0 ? (
            <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-faint)]">
              همهٔ سفارش‌های تأییدشده روی مسیر هستند.
            </p>
          ) : (
            <ul className="board-stagger m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onPointerDown={(e) => onPointerDown(e, o)}
                    onClick={() => {
                      // Only a real click gets here; a drag ends on pointerup and never
                      // produces one.
                      if (!dragging.current) setConfirm({ order: o, runId: null });
                    }}
                    aria-label={`اختصاص سفارش ${o.order_no} برای ${o.customer_name}`}
                    className={`order-card w-full ${
                      drag?.order.id === o.id ? "order-card--lifted" : ""
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-[var(--space-2)]">
                      <span className="truncate text-[length:var(--text-sm)] text-[var(--text)]">
                        {o.customer_name}
                      </span>
                      <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-[var(--text-faint)]">
                        {o.order_no}
                      </span>
                    </span>
                    <span className="mt-[var(--space-1)] flex items-baseline justify-between gap-[var(--space-2)]">
                      <span className="font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
                        {faJalaliDate(o.order_date)}
                      </span>
                      <span className="font-mono text-[length:var(--text-sm)] text-[var(--text)]">
                        {faToman(o.total_toman)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- The runs ---- */}
        <section aria-labelledby="runs-heading">
          <h2
            id="runs-heading"
            className="m-0 mb-[var(--space-3)] text-[length:var(--text-md)] font-medium text-[var(--text)]"
          >
            مسیرهای باز
          </h2>

          {openRuns.length === 0 ? (
            <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-faint)]">
              مسیر بازی وجود ندارد. اول یک مسیر بسازید.
            </p>
          ) : (
            <div className="board-stagger grid gap-[var(--space-3)] sm:grid-cols-2 xl:grid-cols-3">
              {openRuns.map((r) => (
                <article
                  key={r.id}
                  data-run-id={r.id}
                  className={`run-column ${hoverRun === r.id ? "run-column--target" : ""} ${
                    drag ? "run-column--armed" : ""
                  }`}
                >
                  <header className="flex items-center gap-[var(--space-2)]">
                    <Avatar name={r.driver_name} count={r.stop_count} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[length:var(--text-sm)] text-[var(--text)]">
                        {r.driver_name}
                      </span>
                      <span className="block font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
                        {faJalaliDate(r.run_date)}
                      </span>
                    </span>
                  </header>

                  <p className="m-0 mt-[var(--space-3)] font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {faNum(r.stop_count)} ایستگاه · {faNum(r.remaining)} باقی‌مانده
                  </p>

                  <p className="run-column__hint m-0 mt-[var(--space-2)] text-[length:var(--text-xs)]">
                    رها کنید تا اضافه شود
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ---- The drag ghost ---- */}
      {drag && (
        <div
          aria-hidden="true"
          className="drag-ghost"
          style={{
            width: drag.width,
            transform: `translate3d(${drag.x - drag.dx}px, ${drag.y - drag.dy}px, 0) rotate(3deg)`,
          }}
        >
          <span className="flex items-baseline justify-between gap-[var(--space-2)]">
            <span className="truncate text-[length:var(--text-sm)] text-[var(--text)]">
              {drag.order.customer_name}
            </span>
            <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-[var(--text-faint)]">
              {drag.order.order_no}
            </span>
          </span>
        </div>
      )}

      {/* ---- The confirm sheet ---- */}
      {confirm && (
        <div
          className="modal-backdrop-enter fixed inset-0 z-[var(--z-panel)] flex items-end justify-center bg-black/50 p-[var(--space-4)] sm:items-center"
          onClick={() => !busy && setConfirm(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-title"
            onClick={(e) => e.stopPropagation()}
            className="modal-card-enter w-full max-w-md rounded-[var(--radius-2xl)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--elev-3)]"
          >
            <h3
              id="assign-title"
              className="m-0 mb-[var(--space-4)] text-[length:var(--text-lg)] font-medium text-[var(--text)]"
            >
              افزودن به مسیر
            </h3>

            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-[var(--space-4)] gap-y-[var(--space-2)] text-[length:var(--text-sm)]">
              <dt className="text-[var(--text-muted)]">مشتری</dt>
              <dd className="m-0 text-[var(--text)]">{confirm.order.customer_name}</dd>
              <dt className="text-[var(--text-muted)]">شمارهٔ سفارش</dt>
              <dd className="m-0 font-mono text-[var(--text)]">{confirm.order.order_no}</dd>
              <dt className="text-[var(--text-muted)]">مبلغ</dt>
              <dd className="m-0 font-mono text-[var(--text)]">{faToman(confirm.order.total_toman)}</dd>
            </dl>

            <label
              htmlFor="assign-run"
              className="mb-[var(--space-1)] mt-[var(--space-4)] block text-[length:var(--text-xs)] text-[var(--text-muted)]"
            >
              مسیر
            </label>
            <select
              id="assign-run"
              autoFocus
              value={confirm.runId ?? ""}
              onChange={(e) =>
                setConfirm({ ...confirm, runId: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value="">— انتخاب کنید —</option>
              {openRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.driver_name} · {faJalaliDate(r.run_date)}
                </option>
              ))}
            </select>

            {target && (
              <p className="m-0 mt-[var(--space-3)] flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                <Avatar name={target.driver_name} size={22} />
                {target.driver_name} هم‌اکنون {faNum(target.stop_count)} ایستگاه دارد.
              </p>
            )}

            <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
              >
                لغو
              </button>
              <button
                type="button"
                onClick={assign}
                disabled={busy || confirm.runId === null}
                className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.03] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "…" : "افزودن"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
