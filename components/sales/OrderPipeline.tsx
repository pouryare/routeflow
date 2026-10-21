"use client";

import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { useToast } from "@/components/ToastProvider";
import ProcessingModal from "./ProcessingModal";
import SwipeRow from "@/components/mobile/SwipeRow";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { useIsNarrow } from "@/lib/useIsNarrow";
import Pocketed from "@/components/meridian/Pocketed";
import Avatar from "@/components/meridian/Avatar";
import { STAGES, stageOf, moveRefusal, type StageKey } from "./orderStage";

/** Documents an order carries by stage: an invoice once priced, a delivery note once on
 *  a van. Drives the peeking slips behind the card. */
const STAGE_DOCS: Record<StageKey, { papers: 0 | 1 | 2; tone?: "good" | "warn" | "info" }> = {
  draft: { papers: 0 },
  confirmed: { papers: 1, tone: "warn" },
  on_route: { papers: 2, tone: "info" },
  delivered: { papers: 2, tone: "good" },
};

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

/** The artifact's avatar tones, picked from the name so one person keeps one colour. */

/** Cards drawn per lane before the rest are summarised.
 *
 *  Without it the تحویل‌شده lane grows without limit -- it is the only lane nothing ever
 *  leaves -- and a board whose fourth column is nine thousand pixels tall has stopped
 *  being a board: the four stages can no longer be seen against each other, which is the
 *  entire reason for drawing them side by side. The lane header keeps the TRUE total, and
 *  the overflow is stated in words with a link to the full list, never silently dropped. */
const LANE_CAP = 8;

type Drag = { order: PipelineOrder; from: StageKey; x: number; y: number; width: number; dx: number; dy: number };

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
  /* On a phone the lanes scroll sideways, so dragging a draft to the next lane is not possible; a
     draft swipes instead (start side = «تأیید»), through the same PATCH with the 5 s undo. The
     drag stays for a mouse and a wide screen. */
  const narrow = useIsNarrow();
  const undoable = useUndoableAction();
  const swipeConfirm = (order: PipelineOrder) =>
    undoable.run({
      message: `سفارش ${order.order_no} تأیید شد؛ بعد از تأیید قابل ویرایش نیست.`,
      send: async () => {
        const res = await fetch(`/api/sales/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "confirmed" }),
        });
        return res.ok ? { ok: true } : { ok: false, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error };
      },
      failure: "سفارش تأیید نشد؛ دوباره تلاش کنید",
      onDone: () => router.refresh(),
    });
  /* The one move this board makes is draft → confirmed. Say so, and say when there is
     nothing to move: with no drafts every card is click-only, and an unexplained board
     that will not drag is what the user reported as broken (item 22). */
  const drafts = orders.filter((o) => o.status === "DRAFT").length;

  /* Refs, not state: the pointer handlers run on every move, and reading these from
     state would close over whatever the values were when the gesture began. */
  const press = useRef<Drag | null>(null);
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
        toast(friendlyError(json.error, "سفارش تأیید نشد؛ دوباره تلاش کنید"), "error");
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
    const r = e.currentTarget.getBoundingClientRect();
    press.current = {
      order,
      from,
      x: e.clientX,
      y: e.clientY,
      width: r.width,
      /* Where inside the card the grab happened. The ghost is drawn at the pointer MINUS
         this, so it stays under the finger exactly where it was picked up. It used to be
         drawn at a fixed x+14, y-18 from the pointer: the card jumped away from the hand
         (item 22, «۵ سانت دورتر»). Physical coordinates on both sides, so RTL is moot. */
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
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
    setDrag({ order: p.order, from: p.from, x: e.clientX, y: e.clientY, width: p.width, dx: p.dx, dy: p.dy });
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
      <p className="pipe__note">
        <Icon name="info" size="sm" />
        {drafts > 0
          ? "سفارش پیش‌نویس را به ستون «تأییدشده» بکشید تا قیمتش قفل و تأیید شود. بقیهٔ کارت‌ها با کلیک باز می‌شوند."
          : "الان سفارش پیش‌نویسی نیست. روی این تابلو فقط پیش‌نویس به «تأییدشده» کشیده می‌شود؛ مراحل بعدی از خود سفارش جلو می‌روند."}
      </p>
      <div className="board pipe">
        {STAGES.map((stage) => {
          const rows = laneOrders(stage.key);
          const refusal = drag ? moveRefusal(drag.from, stage.key) : null;
          const armed = Boolean(drag) && stage.key !== drag?.from;
          const locked = armed && refusal !== null;
          const over = hover === stage.key && armed && !locked;
          return (
            <section
              key={stage.key}
              data-stage={stage.key}
              aria-label={stage.label}
              className={`col${over ? " over" : ""}`}
              style={locked ? { opacity: 0.55 } : undefined}
            >
              <div className="colhead">
                <div className="t">
                  <span className="st" style={{ background: stage.tone }} aria-hidden />
                  {stage.label}
                </div>
                <span className="c">{faNum(rows.length)}</span>
              </div>

              {rows.slice(0, LANE_CAP).map((o) => {
                const movable = stage.key === "draft";
                const docs = STAGE_DOCS[stage.key];
                return (
                  <Pocketed key={o.id} papers={docs.papers} tone={docs.tone} fan>
                  <SwipeRow
                    ownButtons={false}
                    start={narrow && movable ? { label: "تأیید سفارش", icon: "check", run: () => swipeConfirm(o) } : undefined}
                  >
                  <button
                    type="button"
                    data-tone={docs.tone}
                    data-movable={movable ? "" : undefined}
                    className={`task${drag?.order.id === o.id ? " dragging" : ""}`}
                    onPointerDown={movable && !narrow ? (e) => onPointerDown(e, o, stage.key) : undefined}
                    onPointerMove={movable && !narrow ? onPointerMove : undefined}
                    onPointerUp={movable && !narrow ? onPointerUp : undefined}
                    onPointerCancel={movable && !narrow ? onPointerUp : undefined}
                    onClick={() => {
                      if (suppressClick.current) return;
                      setOpen(o);
                    }}
                    aria-label={`سفارش ${o.order_no} برای ${o.customer_name}`}
                  >
                    <Icon name="package" size="md" />
                    <div className="top">
                      <span className="n">{o.customer_name}</span>
                      <span className="amt">{faNum(o.total_toman)}</span>
                    </div>
                    <div className="m">
                      <span>{faNum(Number(o.order_no.split("-")[1] ?? 0))}#</span>
                      <span className="kg">{faNum(o.kg)} کیلو</span>
                      <span>{faJalaliDate(o.order_date)}</span>
                    </div>
                    {o.salesperson_name && (
                      <div className="asg">
                        <Avatar name={o.salesperson_name} size={20} />
                        {o.salesperson_name}
                      </div>
                    )}
                  </button>
                  </SwipeRow>
                  </Pocketed>
                );
              })}

              {rows.length === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>خالی</p>
              )}

              {rows.length > LANE_CAP && (
                <Link
                  href="/sales/orders"
                  style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
                >
                  {faNum(rows.length - LANE_CAP)} سفارش دیگر در این مرحله ←
                </Link>
              )}

              {locked && refusal && (
                <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--muted)" }}>{refusal}</p>
              )}
            </section>
          );
        })}
      </div>

      {drag && (
        <div
          className="task"
          style={{
            position: "fixed",
            zIndex: 90,
            pointerEvents: "none",
            left: drag.x - drag.dx,
            top: drag.y - drag.dy,
            width: drag.width,
            boxShadow: "var(--sh-3)",
            transform: "rotate(-2deg) scale(1.03)",
            margin: 0,
          }}
          aria-hidden
        >
          <div className="top">
            <span className="n">{drag.order.customer_name}</span>
            <span className="amt">{faNum(drag.order.total_toman)}</span>
          </div>
        </div>
      )}

      <ProcessingModal
        order={open}
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={open?.status === "DRAFT" ? () => void confirmOrder(open) : undefined}
      />
    </>
  );
}
