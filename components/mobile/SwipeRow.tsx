"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { claimPeek, type PeekKind } from "@/lib/peekHint";
import { stretchAllowed } from "@/lib/sheetStops";
import { Icon, type IconName } from "@/components/meridian/Icon";
import { decide, LONG_PRESS_MS, stopAt, SWIPE_DEFAULTS, SWIPE_SHORT } from "@/lib/swipe";
import { buzz } from "@/lib/haptic";

export interface SwipeAction {
  /** What it does, as a verb phrase («ثبت نتیجه»). Also the accessible name of its button. */
  label: string;
  icon: IconName;
  tone?: "good" | "bad";
  /** Several results along one drag (the snooze times): each starts `at` px; the label under the row follows
   *  the finger, a buzz marks each new stop, and letting go runs `run` with the stop reached. */
  stops?: { at: number; label: string }[];
  run: (stop?: number) => void;
}


const TRAVEL = 6;
const CLICK_GUARD_MS = 60;

/** The one-time swipe hint for the first row of a kind of list: true while the face slides aside. */
function usePeek(peek: PeekKind | undefined, hasAction: boolean): boolean {
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    if (!peek || !hasAction || !stretchAllowed()) return;
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {
      /* blocked storage: no hint */
    }
    // Claimed when the timer fires, not before: a mount that is undone at once (React's dev double run)
    // must not use up the one hint.
    let off = 0;
    const on = window.setTimeout(() => {
      if (!claimPeek(peek, store)) return;
      setPeeking(true);
      off = window.setTimeout(() => setPeeking(false), 900);
    }, 600);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [peek, hasAction]);
  return peeking;
}

/** A row that can be dragged sideways to do one thing: `start` is the action on the reading-start
 *  side (right, in Persian), `end` the other. Releasing past the commit distance runs it; a short
 *  drag springs back. Every action also exists as a plain button -- always there for keyboard and
 *  screen-reader use (visible when focused), and shown in full from 768px up -- so the gesture is
 *  a shortcut, never the only way. Run the action through `useUndoableAction`: a swipe is easy to
 *  do by accident, so it ends in the 5 s undo, not in a question.
 *
 *  Mechanics follow components/board/useCardDrag.ts: capture on the row, a travel threshold so a
 *  still finger is a tap, a short click guard after release. `touch-action: pan-y` lets the page
 *  keep scrolling vertically. Do not nest it in a sheet: the sheet's swipe-down listens on the
 *  same touches. */
export default function SwipeRow({ start, end, children, ownButtons = true, onLongPress, short = false, peek }: {
  start?: SwipeAction;
  end?: SwipeAction;
  children: ReactNode;
  /** False when the row already has its own visible buttons for these actions (no duplicates). */
  ownButtons?: boolean;
  /** Holding a still finger on the row for LONG_PRESS_MS (selection mode starts here). */
  onLongPress?: () => void;
  /** A light, undoable action (mark read): half the usual distance commits it. */
  short?: boolean;
  /** The list this row belongs to: the first row of each kind slides open a little once (lib/peekHint.ts). */
  peek?: PeekKind;
}) {
  const [dx, setDx] = useState(0);
  const first = start ?? end;
  const peeking = usePeek(peek, !!first);
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);
  const guard = useRef(false);
  const hold = useRef<number | null>(null);
  const stopHold = () => {
    if (hold.current !== null) window.clearTimeout(hold.current);
    hold.current = null;
  };

  const side = (d: number) => decide({ dx: d }, { ...(short ? SWIPE_SHORT : SWIPE_DEFAULTS), rtl: true });
  const live = side(dx);
  const armed = live.state === "idle" ? null : live.side === "start" ? start : end;
  const stop = armed?.stops ? stopAt(armed.stops, dx) : -1;
  const lastStop = useRef(-1);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" || !(start || end || onLongPress)) return;
    press.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moved.current = false;
    stopHold();
    if (onLongPress) {
      hold.current = window.setTimeout(() => {
        hold.current = null;
        press.current = null; // the gesture is now a long press, not a swipe or a tap
        guard.current = true;
        window.setTimeout(() => (guard.current = false), 400);
        onLongPress();
      }, LONG_PRESS_MS);
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p) return;
    const mx = e.clientX - p.x;
    const my = e.clientY - p.y;
    if (Math.abs(mx) > TRAVEL || Math.abs(my) > TRAVEL) stopHold(); // a moving finger is not a long press
    if (!moved.current) {
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > TRAVEL) {
        press.current = null; // a scroll; let the page have it
        return;
      }
      if (Math.abs(mx) < TRAVEL) return;
      moved.current = true;
      e.currentTarget.setPointerCapture(p.id);
    }
    // Only drag toward a side that has an action.
    const toStart = mx > 0;
    const a = toStart ? start : end;
    if (!a) return setDx(0);
    const far = a.stops ? a.stops[a.stops.length - 1].at + 30 : short ? 110 : 220;
    const next = Math.max(-far, Math.min(far, mx));
    if (a.stops) {
      const k = stopAt(a.stops, next);
      if (k !== lastStop.current && k >= 0) buzz(8);
      lastStop.current = k;
    }
    setDx(next);
  }
  function release(e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    stopHold();
    const p = press.current;
    press.current = null;
    if (!p || !moved.current) return;
    const r = side(e.clientX - p.x);
    const reached = lastStop.current;
    lastStop.current = -1;
    setDx(0);
    guard.current = true;
    window.setTimeout(() => (guard.current = false), CLICK_GUARD_MS);
    if (cancelled || r.state !== "commit") return;
    const a = r.side === "start" ? start : end;
    if (a?.stops) {
      if (reached >= 0) a.run(reached);
    } else a?.run();
  }

  const btn = (a: SwipeAction, which: "start" | "end") => (
    <button key={which} type="button" className={`swiperow__btn swiperow__btn--${a.tone ?? "good"}`} onClick={() => a.run()}>
      <Icon name={a.icon} size="md" />
      {a.label}
    </button>
  );

  return (
    <div className="swiperow">
      {/* The action under the row while dragging: what letting go will do. */}
      {/* The one-time hint: the action under the row shows while the face slides aside and back. */}
      {peeking && !armed && first && (
        <div className={`swiperow__under swiperow__under--reveal swiperow__under--${start ? "start" : "end"} swiperow__under--${first.tone ?? "good"}`} aria-hidden>
          <Icon name={first.icon} size="md" />
          {first.label}
        </div>
      )}
      {armed && (
        <div className={`swiperow__under swiperow__under--${live.state === "commit" ? "commit" : "reveal"} swiperow__under--${live.state !== "idle" ? live.side : "start"} swiperow__under--${armed.tone ?? "good"}`} aria-hidden>
          <Icon name={armed.icon} size="md" />
          {armed.stops && stop >= 0 ? <span key={stop} className="swiperow__stop">{armed.stops[stop].label}</span> : armed.label}
        </div>
      )}
      <div
        className={`swiperow__face${peeking ? ` swiperow__face--peek-${start ? "start" : "end"}` : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform .18s ease" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onClickCapture={(e) => {
          if (guard.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {children}
        {ownButtons && (start || end) && (
          <div className="swiperow__buttons">
            {start && btn(start, "start")}
            {end && btn(end, "end")}
          </div>
        )}
      </div>
    </div>
  );
}
