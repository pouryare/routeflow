"use client";

import BottomSheet from "@/components/mobile/BottomSheet";
import { Icon } from "@/components/meridian/Icon";
import { taskKindLabel } from "@/lib/tasks/labels";
import { useState } from "react";
import { faNum } from "@/lib/format";
import type { BoardLane } from "@/lib/repo/board";
import type { TaskCard } from "@/lib/repo/taskCard";
import { lanesFor, type BoardView } from "@/lib/tasks/lenses";

/** The Board on a phone: no side-by-side lanes, no horizontal scroll. Either a lane
 *  pager (one lane, full width, stepped by a segmented control) or a vertical accordion.
 *  A card moves via a bottom sheet, never a drag. The choice persists per member. */
export default function BoardMobile({
  lanes,
  view,
  initialMode,
  onMove,
  onCustomer,
}: {
  lanes: BoardLane[];
  view: BoardView;
  initialMode: "pager" | "stack";
  onMove: (card: TaskCard, toLane: string) => void | Promise<void>;
  onCustomer: (id: number) => void;
}) {
  const [mode, setMode] = useState<"pager" | "stack">(initialMode);
  const [laneIxRaw, setLaneIx] = useState(0);
  /* Lanes can shrink under the cursor (a refetch, a view switch). Clamp at render rather
     than resetting from an effect, which set state after every such render. */
  const laneIx = laneIxRaw < lanes.length ? laneIxRaw : 0;
  const [accOpen, setAccOpen] = useState(0);
  const [sheetFor, setSheetFor] = useState<{ card: TaskCard; laneId: string } | null>(null);


  function pickMode(m: "pager" | "stack") {
    setMode(m);
    void fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board_mobile_mode: m }),
    });
  }

  const card = (c: TaskCard, laneId: string) => (
    <div
      key={c.id}
      className="task"
      style={{ touchAction: "auto", cursor: "default" }}
    >
      <div className="n" style={{ fontSize: 12.5 }}>
        {c.title}
      </div>
      <div className="m" style={{ marginTop: 4 }}>
        {c.customer ? (
          <button
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] more"
            style={{ border: 0, background: "none", padding: 0, cursor: "pointer" }}
            onClick={() => onCustomer(c.customer!.id)}
          >
            <Icon name="package" size="md" />
            {c.customer.name}
          </button>
        ) : null}
        <span>{taskKindLabel(c.kind)}</span>
      </div>
      <button
        type="button"
        aria-label="انتقال"
        onClick={() => setSheetFor({ card: c, laneId })}
        style={{
          marginTop: 8,
          border: "1px solid var(--line-2)",
          background: "var(--card-2)",
          color: "var(--muted)",
          borderRadius: 7,
          padding: "3px 10px",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <Icon name="more" size="sm" /> انتقال
      </button>
    </div>
  );

  return (
    <div style={{ padding: "6px 16px 16px" }}>
      <div className="acts" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={`btn ${mode === "pager" ? "solid" : "ghost"}`}
          onClick={() => pickMode("pager")}
        >
          <Icon name="grip-vertical" size="md" />
          پیمایش ستون‌ها
        </button>
        <button
          type="button"
          className={`btn ${mode === "stack" ? "solid" : "ghost"}`}
          onClick={() => pickMode("stack")}
        >
          <Icon name="panel-side" size="md" />
          ستون عمودی
        </button>
      </div>
      <p style={{ fontSize: 10.5, color: "var(--muted)", margin: "0 0 10px" }}>
        این انتخاب برای هر کاربر ذخیره می‌شود.
      </p>

      {mode === "pager" ? (
        <>
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "var(--sunk)",
              borderRadius: 999,
              padding: 4,
              overflowX: "auto",
            }}
          >
            {lanes.map((l, i) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={i === laneIx}
                onClick={() => setLaneIx(i)}
                style={{
                  flex: "1 0 auto",
                  border: 0,
                  borderRadius: 999,
                  padding: "7px 10px",
                  fontSize: 11.5,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  background: i === laneIx ? "var(--card)" : "transparent",
                  color: i === laneIx ? "var(--ink)" : "var(--muted)",
                  fontWeight: i === laneIx ? 600 : 400,
                  boxShadow: i === laneIx ? "var(--sh-1)" : "none",
                }}
              >
                <Icon name="package" size="md" />
                {l.label} {faNum(l.total)}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {(lanes[laneIx]?.cards ?? []).map((c) => card(c, lanes[laneIx].id))}
            {(lanes[laneIx]?.cards.length ?? 0) === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>در این ستون کاری نیست.</p>
            ) : null}
          </div>
        </>
      ) : (
        <div>
          {lanes.map((l, i) => (
            <div
              key={l.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: "var(--r-md)",
                marginBottom: 8,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setAccOpen(accOpen === i ? -1 : i)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: 0,
                  background: "var(--card-2)",
                  color: "var(--ink)",
                  padding: "10px 12px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Icon name="package" size="md" />
                <span>{l.label}</span>
                <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                  {faNum(l.total)} {accOpen === i ? "–" : "+"}
                </span>
              </button>
              {accOpen === i ? (
                <div style={{ padding: 8 }}>
                  {l.cards.map((c) => card(c, l.id))}
                  {l.cards.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--muted)", padding: 6 }}>—</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {sheetFor ? (
        <MoveSheet
          card={sheetFor.card}
          fromLane={sheetFor.laneId}
          view={view}
          onPick={(to) => {
            void onMove(sheetFor.card, to);
            setSheetFor(null);
          }}
          onClose={() => setSheetFor(null)}
        />
      ) : null}
    </div>
  );
}

function MoveSheet({
  card,
  fromLane,
  view,
  onPick,
  onClose,
}: {
  card: TaskCard;
  fromLane: string;
  view: BoardView;
  onPick: (toLane: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open title="انتقال کار" subtitle={`انتقال «${card.title.slice(0, 22)}» به:`} onClose={onClose} closeLabel="بستن انتقال">
      <div className="tf-grid one">
        {lanesFor(view, card.kind)
          .filter((l) => l.id !== fromLane)
          .map((l) => (
            <button key={l.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" onClick={() => onPick(l.id)}>
              <Icon name="grip-vertical" size="md" />
              {l.label}
            </button>
          ))}
      </div>
    </BottomSheet>
  );
}
