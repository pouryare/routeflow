"use client";

import { CardHelp } from "@/components/meridian/CardHelp";
import { Icon } from "@/components/meridian/Icon";
import { TASK_KIND_TONE, taskKindLabel } from "@/lib/tasks/labels";
import { useCallback, useRef, useState } from "react";
import { faNum } from "@/lib/format";
import type { Board as BoardData } from "@/lib/repo/board";
import type { TaskCard } from "@/lib/repo/taskCard";
import { lanesFor, movePatch, type BoardView } from "@/lib/tasks/lenses";
import CustomerSheet from "@/components/meridian/CustomerSheet";
import OutcomeFlow from "@/components/flows/OutcomeFlow";
import { useCardDrag } from "./useCardDrag";
import BoardMobile from "./BoardMobile";
import Avatar from "@/components/meridian/Avatar";
import Pocketed from "@/components/meridian/Pocketed";

const KIND_TONE = TASK_KIND_TONE as Record<string, string>;
const WF_KINDS: { key: string; label: string }[] = [
  { key: "outreach", label: "پیگیری تماس" },
  { key: "order", label: "سفارش" },
  { key: "visit", label: "بازدید" },
];

export default function Board({
  initialBoard,
  initialView,
  mobileMode,
}: {
  initialBoard: BoardData;
  initialView: BoardView;
  mobileMode: "pager" | "stack";
}) {
  const [view, setView] = useState<BoardView>(initialView);
  const [wfKind, setWfKind] = useState<string>(initialBoard.kind ?? "outreach");
  const [board, setBoard] = useState<BoardData>(initialBoard);
  const [custId, setCustId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  /* The card whose closing is waiting for an outcome. `key` remounts the sheet per ask so each
     starts on its question; `open` only slides it in and out. */
  const [outcomeFor, setOutcomeFor] = useState<{ cardId: number; toLane: string; key: number; open: boolean } | null>(null);
  const outcomeKey = useRef(0);
  const [log, setLog] = useState<string>("");

  const refetch = useCallback(
    async (v: BoardView, k: string) => {
      const qs = new URLSearchParams({ view: v });
      if (v === "workflow") qs.set("kind", k);
      const res = await fetch(`/api/board?${qs}`);
      const j = (await res.json()) as { ok: boolean; board?: BoardData };
      if (j.ok && j.board) setBoard(j.board);
    },
    []
  );

  /* A view or workflow switch refetches from the handler that made it, not from an effect
     watching the state: the effect set state on every render that followed it, and the
     first board already arrives from the server, so there is nothing to fetch on mount. */
  const pickView = (v: BoardView) => {
    setView(v);
    void refetch(v, wfKind);
  };
  const pickKind = (k: string) => {
    setWfKind(k);
    void refetch("workflow", k);
  };

  const commitMove = useCallback(
    async (card: TaskCard, toLane: string, outcomeCode?: string) => {
      setMenuId(null);
      setOutcomeFor(null);
      const res = await fetch(`/api/tasks/${card.id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view, to_lane: toLane, outcome_code: outcomeCode }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (j.ok) {
        const label = lanesFor(view, card.kind).find((l) => l.id === toLane)?.label ?? toLane;
        setLog(`«${card.title.slice(0, 26)}» → ${label} · در هر سه نما همگام شد`);
      }
      await refetch(view, wfKind);
    },
    [view, wfKind, refetch]
  );

  /** A drop into a lane that closes an outreach task asks for an outcome first (reusing
   *  the /start chips); every other move commits straight away. */
  const move = useCallback(
    (card: TaskCard, toLane: string) => {
      const patch = movePatch(card, view, toLane, new Date().toISOString());
      if (patch.status === "done" && card.kind === "outreach") {
        setMenuId(null);
        outcomeKey.current += 1;
        setOutcomeFor({ cardId: card.id, toLane, key: outcomeKey.current, open: true });
        return;
      }
      void commitMove(card, toLane);
    },
    [view, commitMove]
  );

  const drag = useCardDrag<TaskCard>({
    resolveLane: (x, y) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-lane]")
        ?.dataset.lane ?? null,
    onDrop: (card, _from, to) => void move(card, to),
  });

  const lanes = board.lanes;
  const outcomeCard = outcomeFor ? lanes.flatMap((l) => l.cards).find((c) => c.id === outcomeFor.cardId) ?? null : null;
  const boardCls = `board${lanes.length >= 4 ? " pipe" : ""}`;

  const toolbar = (
    <div className="bhead" style={{ paddingBottom: 8 }}>
      <div className="acts">
        {(["status", "time", "workflow"] as BoardView[]).map((v) => (
          <button
            key={v}
            type="button"
            className={`btn ${view === v ? "solid" : "ghost"}`}
            onClick={() => pickView(v)}
          >
            <Icon name="grip-vertical" size="md" />
            {v === "status" ? "وضعیت" : v === "time" ? "زمان" : "گردش‌کار"}
          </button>
        ))}
      </div>
      {view === "workflow" ? (
        <div className="acts">
          {WF_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={`btn ${wfKind === k.key ? "solid" : "ghost"}`}
              onClick={() => pickKind(k.key)}
            >
              <Icon name="package" size="md" />
              {k.label}
            </button>
          ))}
        </div>
      ) : (
        <span className="n" style={{ fontFamily: "var(--fa)" }}>
          بکشید و رها کنید — یا از منوی هر کارت
        </span>
      )}
    </div>
  );

  return (
    <div className="kblock" style={{ marginTop: 16 }}>
      <div className="bhead">
        <div>
          <h2>تختهٔ کارها</h2>
          <div className="n">
            {faNum(lanes.reduce((s, l) => s + l.total, 0))} کار
            {view === "workflow" && board.hiddenCount > 0
              ? ` · ${faNum(board.hiddenCount)} کار از نوع‌های دیگر پنهان است`
              : ""}
          </div>
        </div>
        <CardHelp id="card.board" />
      </div>
      {toolbar}

      {/* Both layouts are in the markup and a media query picks one (see `.board-mobile` /
          `.board-desktop` in globals.css). Choosing in JS meant a phone first painted the desk
          board and swapped after hydration. */}
      <div className="board-mobile">
        <BoardMobile
          lanes={lanes}
          view={view}
          initialMode={mobileMode}
          onMove={move}
          onCustomer={setCustId}
        />
      </div>
      <div className="board-desktop">
        <>
          <div className={boardCls} style={{ padding: "6px 24px 20px" }}>
            {lanes.map((lane) => (
              <section
                key={lane.id}
                data-lane={lane.id}
                aria-label={lane.label}
                className={`col${drag.hoverLane === lane.id && drag.drag ? " over" : ""}`}
              >
                <div className="colhead">
                  <div className="t">
                    <span
                      className="st"
                      style={{
                        background:
                          lane.id === "done" || lane.id === "delivered"
                            ? "var(--sage)"
                            : "var(--accent)",
                      }}
                      aria-hidden
                    />
                    {lane.label}
                  </div>
                  <span className="c">{faNum(lane.total)}</span>
                </div>

                {lane.cards.map((card) => (
                  <Pocketed
                    key={card.id}
                    papers={card.customer ? 1 : 0}
                    tone={lane.id === "done" || lane.id === "delivered" ? "good" : undefined}
                    fan={false}
                  >
                  <div
                    className={`task${drag.drag?.item.id === card.id ? " dragging" : ""}`}
                    {...drag.bind(card, lane.id)}
                  >
                    <div className="top">
                      <span
                        className="n"
                        style={{ color: `var(--${KIND_TONE[card.kind] ?? "muted"})`, fontSize: 11 }}
                      >
                        {taskKindLabel(card.kind)}
                        {card.recur ? <Icon name="repeat" size="sm" label="تکرارشونده" /> : null}
                      </span>
                      {card.priority === "CRITICAL" || card.priority === "HIGH" ? (
                        <span
                          className="st"
                          style={{
                            background:
                              card.priority === "CRITICAL" ? "var(--crit)" : "var(--amber)",
                          }}
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <div className="n" style={{ marginTop: 4 }}>
                      {card.title}
                    </div>
                    <div className="m">
                      {card.customer ? (
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-[var(--space-2)] more"
                          style={{ border: 0, background: "none", padding: 0, cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!drag.isSuppressed()) setCustId(card.customer!.id);
                          }}
                        >
                          <Icon name="package" size="md" />
                          {card.customer.name}
                        </button>
                      ) : null}
                      {card.assignee ? (
                        <span className="asg" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Avatar userId={card.assignee.id} name={card.assignee.name} size={18} />
                          {card.assignee.name}
                        </span>
                      ) : null}
                    </div>

                    <div className="top" style={{ marginTop: 8 }}>
                      <span style={{ color: "var(--line-2)", letterSpacing: -2 }} aria-hidden>
                        ⋮⋮
                      </span>
                      <button
                        type="button"
                        aria-label="انتقال"
                        style={{
                          border: "1px solid var(--line-2)",
                          background: "var(--card-2)",
                          color: "var(--muted)",
                          borderRadius: 7,
                          padding: "2px 8px",
                          cursor: "pointer",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!drag.isSuppressed())
                            setMenuId(menuId === card.id ? null : card.id);
                        }}
                      >
                        <Icon name="more" size="sm" />
                      </button>
                    </div>

                    {menuId === card.id ? (
                      <div
                        style={{
                          marginTop: 8,
                          borderTop: "1px dashed var(--line-2)",
                          paddingTop: 8,
                        }}
                      >
                        <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 5 }}>
                          انتقال به:
                        </div>
                        {lanesFor(view, card.kind)
                          .filter((l) => l.id !== lane.id)
                          .map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void move(card, l.id);
                              }}
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "start",
                                border: "1px solid var(--line)",
                                background: "var(--card-2)",
                                color: "var(--ink)",
                                borderRadius: 7,
                                padding: "6px 9px",
                                fontSize: 12,
                                marginBottom: 4,
                                cursor: "pointer",
                              }}
                            >
                              <Icon name="grip-vertical" size="md" />
                              {l.label}
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                  </Pocketed>
                ))}

                {lane.cards.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>در این ستون کاری نیست.</p>
                ) : null}
              </section>
            ))}
          </div>

          {drag.drag ? (
            <div
              className="task"
              aria-hidden
              style={{
                position: "fixed",
                zIndex: 90,
                pointerEvents: "none",
                left: drag.drag.x - drag.drag.dx,
                top: drag.drag.y - drag.drag.dy,
                width: drag.drag.width,
                boxShadow: "var(--sh-3)",
                transform: "rotate(-2deg) scale(1.03)",
                margin: 0,
              }}
            >
              <div className="n">{drag.drag.item.title.slice(0, 30)}</div>
            </div>
          ) : null}
        </>
      </div>

      <div className="hint" aria-live="polite">
        {log ? <span>{log}</span> : <span>یک کارت را جابه‌جا کنید تا در هر سه نما هم‌گام شود.</span>}
      </div>

      {outcomeFor && outcomeCard ? (
        <OutcomeFlow
          key={outcomeFor.key}
          open={outcomeFor.open}
          taskLabel={outcomeCard.title}
          allowNone
          decide={async (code) => {
            await commitMove(outcomeCard, outcomeFor.toLane, code ?? undefined);
            return { ok: true };
          }}
          onClose={() => setOutcomeFor((o) => (o ? { ...o, open: false } : o))}
          onReopen={() => setOutcomeFor((o) => (o ? { ...o, open: true } : o))}
        />
      ) : null}

      <CustomerSheet customerId={custId} onClose={() => setCustId(null)} />
    </div>
  );
}
