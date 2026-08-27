"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { useToast } from "@/components/ToastProvider";
import { Avatar } from "@/components/AvatarStack";
import ProcessingModal from "./ProcessingModal";
import { STAGES, stageOf, moveRefusal, type StageKey } from "./orderStage";

export interface PipelineOrder {
  id: number;
  order_no: string;
  customer_name: string;
  salesperson_name: string | null;
  status: string;
  order_date: string;
  total_toman: number;
  paid_toman: number;
  payment_status: string;
  kg: number;
  line_count: number;
  on_run: boolean;
}

/** Pixels of travel before a press becomes a drag. Below this it is a tap: on a phone a
 *  finger never holds perfectly still, and without the threshold every tap would start a
 *  drag and no card could ever be opened by touch. */
const DRAG_THRESHOLD = 6;

/** How long a click is swallowed after a drag ends. The drop and the click arrive in the
 *  same gesture, so without this a successful drag also opens the modal. */
const CLICK_GUARD_MS = 60;

/** Cards drawn per lane before the rest are summarised.
 *
 *  Without it the تحویل‌شده lane grows without limit -- it is the only lane nothing ever
 *  leaves -- and a board whose fourth column is nine thousand pixels tall has stopped
 *  being a board: the four stages can no longer be seen against each other, which is the
 *  entire reason for drawing them side by side. The lane header keeps the TRUE total, and
 *  the overflow is stated in words with a link to the full list, never silently dropped. */
const LANE_CAP = 12;

type Drag = { order: PipelineOrder; from: StageKey; x: number; y: number; width: number };

/** The order board (MASTER.md, "Order pipeline").
 *
 *  Self-contained the way AssignmentBoard is: it does its own PATCH and its own
 *  router.refresh() rather than taking an onMove callback, because the pages that render
 *  it are server components and a function cannot cross that boundary.
 *
 *  Exactly one drag writes -- پیش‌نویس → تأییدشده. Every other combination is refused
 *  with a reason by `moveRefusal`, which is tested, and the lanes that cannot accept the
 *  card in hand dim while it is being dragged, so an impossible drop reads as impossible
 *  before it is attempted.
 */
export default function OrderPipeline({ orders }: { orders: PipelineOrder[] }) {
  const router = useRouter();
  const toast = useToast();

  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<StageKey | null>(null);
  const [open, setOpen] = useState<PipelineOrder | null>(null);
  const [busy, setBusy] = useState(false);

  /* Refs, not state: the pointer handlers run on every move, and reading these from
     state would close over whatever the values were when the gesture began. */
  const press = useRef<{ order: PipelineOrder; from: StageKey; x: number; y: number; width: number } | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  /* The lane under the pointer is kept in a ref as well as in state. pointerup can land
     in the same task as the last pointermove, and `hover` would still be the previous
     render's value -- a drop onto the right lane refused because the state had not
     committed yet is the kind of bug that only shows up on a fast gesture. */
  const hoverRef = useRef<StageKey | null>(null);

  const laneOrders = (key: StageKey) =>
    orders.filter((o) => stageOf(o.status, o.on_run) === key);

  async function confirmOrder(order: PipelineOrder) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "تأیید سفارش انجام نشد", "error");
        return;
      }
      toast(`سفارش ${order.order_no} تأیید شد`, "success");
      setOpen(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, order: PipelineOrder, from: StageKey) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    /* Captured ON THE CARD. Capturing on the board retargets the whole gesture, click
       included, so every tap would report the board as its target and could never say
       which card it hit.
       And NO preventDefault() here: it suppresses the compatibility mouse events and the
       card's own click never fires. Selection is guarded by CSS instead -- see .board. */
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = {
      order,
      from,
      x: e.clientX,
      y: e.clientY,
      width: e.currentTarget.getBoundingClientRect().width,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p) return;
    if (!dragging.current) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      dragging.current = true;
    }

    /* elementFromPoint rather than cached rectangles: a lane can scroll or reflow
       mid-drag and a cached box would point at where the lane used to be. The ghost is
       pointer-events:none, so it never answers instead of the lane under it. */
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const lane = el?.closest<HTMLElement>("[data-stage]");
    const key = (lane?.dataset.stage as StageKey | undefined) ?? null;
    hoverRef.current = key;
    setHover(key);
    setDrag({ order: p.order, from: p.from, x: e.clientX, y: e.clientY, width: p.width });
  }

  function onPointerUp() {
    const p = press.current;
    const wasDragging = dragging.current;
    const target = hoverRef.current;
    press.current = null;
    dragging.current = false;
    hoverRef.current = null;
    setDrag(null);
    setHover(null);

    if (!p || !wasDragging) return;

    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, CLICK_GUARD_MS);

    if (!target || target === p.from) return;
    const why = moveRefusal(p.from, target);
    if (why) {
      toast(why, "error");
      return;
    }
    void confirmOrder(p.order);
  }

  return (
    <>
      <div className="board">
        {STAGES.map((stage) => {
          const rows = laneOrders(stage.key);
          const refusal = drag ? moveRefusal(drag.from, stage.key) : null;
          const armed = Boolean(drag) && stage.key !== drag?.from;
          const locked = armed && refusal !== null;
          return (
            <section
              key={stage.key}
              data-stage={stage.key}
              aria-label={stage.label}
              className={`lane${armed ? " lane--armed" : ""}${locked ? " lane--locked" : ""}${
                hover === stage.key && !locked && armed ? " lane--target" : ""
              }`}
              style={{ ["--lane-tone" as string]: stage.tone }}
            >
              <header className="lane__head">
                <span className="lane__dot" aria-hidden />
                <span className="lane__name">{stage.label}</span>
                <span className="lane__count num">{faNum(rows.length)}</span>
              </header>

              <div className="lane__cards">
              {rows.slice(0, LANE_CAP).map((o) => {
                const movable = stage.key === "draft";
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`task${drag?.order.id === o.id ? " task--lifted" : ""}`}
                    onPointerDown={movable ? (e) => onPointerDown(e, o, stage.key) : undefined}
                    onPointerMove={movable ? onPointerMove : undefined}
                    onPointerUp={movable ? onPointerUp : undefined}
                    onPointerCancel={movable ? onPointerUp : undefined}
                    onClick={() => {
                      if (suppressClick.current) return;
                      setOpen(o);
                    }}
                    aria-label={`سفارش ${o.order_no} برای ${o.customer_name}`}
                  >
                    <span className="task__row">
                      <span className="truncate text-[length:var(--text-sm)] text-[var(--text)]">
                        {o.customer_name}
                      </span>
                      <span className="num shrink-0 text-[length:var(--text-sm)] text-[var(--text)]">
                        {faToman(o.total_toman)}
                      </span>
                    </span>
                    <span className="task__meta flex items-center gap-[var(--space-2)]">
                      {o.salesperson_name && <Avatar name={o.salesperson_name} size={20} />}
                      <span className="num">{faJalaliDate(o.order_date)}</span>
                      <span className="num">{faNum(o.kg)} کیلو</span>
                    </span>
                  </button>
                );
              })}

              {rows.length === 0 && (
                <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  خالی
                </p>
              )}
              </div>

              {rows.length > LANE_CAP && (
                <a
                  href={`/sales/orders`}
                  className="m-0 text-[length:var(--text-xs)] text-[var(--accent-text)] no-underline hover:underline"
                >
                  {faNum(rows.length - LANE_CAP)} سفارش دیگر در این مرحله ←
                </a>
              )}

              <p className="lane__hint">
                {refusal ?? (stage.key === drag?.from ? "" : "رها کنید تا تأیید شود")}
              </p>
            </section>
          );
        })}
      </div>

      {drag && (
        <div
          className="task-ghost"
          style={{ left: drag.x + 14, top: drag.y - 18, width: drag.width }}
          aria-hidden
        >
          <span className="task__row">
            <span className="truncate text-[length:var(--text-sm)] text-[var(--text)]">
              {drag.order.customer_name}
            </span>
            <span className="num shrink-0 text-[length:var(--text-sm)] text-[var(--text)]">
              {faToman(drag.order.total_toman)}
            </span>
          </span>
        </div>
      )}

      <ProcessingModal
        order={open}
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={open?.status === "draft" ? () => void confirmOrder(open) : undefined}
      />
    </>
  );
}
