"use client";

import { TASK_KIND_TONE } from "@/lib/tasks/labels";
import { useCallback, useState } from "react";
import Link from "next/link";
import { faNum } from "@/lib/format";
import type { Pocket as PocketData, PocketTeamMember } from "@/lib/repo/pocket";
import type { TaskCard } from "@/lib/repo/taskCard";
import CustomerSheet from "@/components/meridian/CustomerSheet";
import QuickAdd from "./QuickAdd";
import AfterCallFlow from "@/components/crm/AfterCallFlow";
import { Icon, type IconName } from "@/components/meridian/Icon";

const KIND_TONE = TASK_KIND_TONE as Record<string, string>;
const DUE_LABEL = (c: TaskCard, now = new Date().toISOString().slice(0, 10)) =>
  c.status === "done"
    ? "انجام‌شده"
    : !c.due_at
      ? "بی‌موعد"
      : c.due_at.slice(0, 10) <= now
        ? "امروز"
        : "این هفته";

const TILE_WASH = ["sand", "mint", "peach", "sky"] as const;
const TILE_ICON: Record<string, IconName> = {
  reminders_today: "bell",
  tasks_today: "check",
  orders_open: "package",
  visits_week: "map-pin",
};

export default function Pocket({
  initial,
  team,
  viewerName,
}: {
  initial: PocketData;
  team: PocketTeamMember[];
  viewerName: string;
}) {
  const [data, setData] = useState<PocketData>(initial);
  const [scopeId, setScopeId] = useState<number | null>(null);
  const [custId, setCustId] = useState<number | null>(null);
  const [quick, setQuick] = useState<"reminder" | "note" | null>(null);
  const [flow, setFlow] = useState<{ customerId: number; taskId: number; open: boolean } | null>(null);

  const refetch = useCallback(async (userId: number | null) => {
    const qs = userId ? `?user_id=${userId}` : "";
    const res = await fetch(`/api/pocket${qs}`);
    const j = (await res.json()) as { ok: boolean; pocket?: PocketData };
    if (j.ok && j.pocket) setData(j.pocket);
  }, []);

  function pickScope(id: number | null) {
    setScopeId(id);
    void refetch(id);
  }

  const row = (c: TaskCard) => (
    <div
      key={c.id}
      style={{
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        padding: "10px 2px",
        borderBottom: "1px solid var(--line)",
        fontSize: 12.5,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          flex: "none",
          marginTop: 1,
          display: "grid",
          placeItems: "center",
          background: `color-mix(in srgb, var(--${KIND_TONE[c.kind] ?? "muted"}) 18%, transparent)`,
        }}
      >
        <i
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            display: "block",
            background: `var(--${KIND_TONE[c.kind] ?? "muted"})`,
          }}
        />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {c.title}
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            marginTop: 3,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--sunk)",
            }}
          >
            {DUE_LABEL(c)}
          </span>
          {c.recur ? <Icon name="repeat" size="sm" label="تکرارشونده" /> : null}
          {c.customer && c.status === "open" && c.kind !== "order" && c.kind !== "delivery_retry" ? (
            <button type="button" className="btn solid" style={{ padding: "2px 10px", fontSize: 11 }}
              onClick={() => setFlow({ customerId: c.customer!.id, taskId: c.id, open: true })}>
              ثبت نتیجه
            </button>
          ) : null}
          {c.customer ? (
            <button
              type="button"
              onClick={() => setCustId(c.customer!.id)}
              style={{
                border: 0,
                background: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--accent)",
                borderBottom: "1px dashed color-mix(in srgb, var(--accent) 45%, transparent)",
              }}
            >
              {c.customer.name}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  const group = (title: string, cards: TaskCard[]) =>
    cards.length > 0 ? (
      <div key={title}>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--muted)",
            margin: "14px 0 6px",
            textTransform: "uppercase",
            letterSpacing: ".05em",
          }}
        >
          {title} · {faNum(cards.length)}
        </div>
        {cards.map(row)}
      </div>
    ) : null;

  return (
    <div style={{ marginTop: 14 }}>
      <h2 style={{ fontSize: 18 }}>
        کارهای {scopeId ? data.scopeName : viewerName}
      </h2>

      {team.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            padding: "10px 0 4px",
          }}
        >
          <button
            type="button"
            className={`chip${scopeId === null ? " on" : ""}`}
            onClick={() => pickScope(null)}
            style={scopeId === null ? { borderColor: "var(--accent)" } : undefined}
          >
            خودم
          </button>
          {team.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip"
              onClick={() => pickScope(m.id)}
              style={{
                whiteSpace: "nowrap",
                ...(scopeId === m.id ? { borderColor: "var(--accent)" } : {}),
              }}
            >
              {m.name} <span style={{ color: "var(--muted)" }}>{faNum(m.open)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="acts" style={{ margin: "14px 0 8px" }}>
        <button type="button" className="btn ghost" onClick={() => setQuick("reminder")}>
          + یادآوری
        </button>
        <button type="button" className="btn ghost" onClick={() => setQuick("note")}>
          + یادداشت
        </button>
        <Link className="btn ghost" href="/sales/orders/new">
          + سفارش
        </Link>
        <Link className="btn ghost" href="/planner">
          + بازدید
        </Link>
      </div>

      {quick ? (
        <QuickAdd kind={quick} onClose={() => setQuick(null)} onAdded={() => void refetch(scopeId)} />
      ) : null}

      <div className="statrow" style={{ marginTop: 14 }}>
        {data.tiles.map((t, i) => (
          <div key={t.key} className={`gcard ${TILE_WASH[i]}`}>
            <div className="ico">
              <Icon name={TILE_ICON[t.key]} size="md" />
            </div>
            <div className="k">{t.label}</div>
            <div className="v">{faNum(t.n)}</div>
            <div className="d">{t.hint}</div>
          </div>
        ))}
      </div>

      <div className="kblock" style={{ marginTop: 16 }}>
        <div className="bhead">
          <div>
            <h2>کارهای من</h2>
            <div className="n">
              {faNum(data.today.length + data.week.length)} کار باز
            </div>
          </div>
        </div>
        <div className="kblock__body">
          {group("امروز", data.today)}
          {group("این هفته", data.week)}
          {group("انجام‌شده", data.done)}
          {data.today.length + data.week.length + data.done.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", padding: "14px 0" }}>
              کاری برای نمایش نیست.
            </p>
          ) : null}
        </div>
      </div>

      {flow ? (
        <AfterCallFlow key={flow.taskId} customerId={flow.customerId} taskId={flow.taskId} open={flow.open}
          onHide={() => setFlow((f) => (f ? { ...f, open: false } : f))}
          onReopen={() => setFlow((f) => (f ? { ...f, open: true } : f))}
          onFinished={() => { setFlow(null); void refetch(scopeId); }} />
      ) : null}
      <CustomerSheet customerId={custId} onClose={() => setCustId(null)} />
    </div>
  );
}
