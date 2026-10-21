"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TapFlow from "@/components/tapflow/TapFlow";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { useToast } from "@/components/ToastProvider";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { countChips, countDiff, countMovement, countWritesNothing, stockCountFlow } from "@/lib/flows/stockCount";
import { faNum } from "@/lib/format";

export interface CountRow {
  product_id: number;
  name: string;
  base_unit: string;
  /** What the books say is on THIS facility's shelf. */
  expected: number;
}

const FAILURE = "شمارش ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";
const fmt = (n: number) => faNum(n, { maximumFractionDigits: 2 });

/** A shelf count, product by product (docs/tap-flow-principles.md §7: «Stock count»).
 *
 *  Each product is its own small flow: «درست است» is one tap and writes nothing, a difference
 *  asks for the number and why. The sheet moves on to the next product at once -- 50 products at
 *  5 s each would be a bad afternoon -- and every difference gets its own undo toast, which
 *  cancels the write and brings that product back.
 *
 *  Mount it with a fresh `key` each time it opens. */
export default function StockCountFlow({
  open,
  rows,
  facility,
  onClose,
}: {
  open: boolean;
  rows: CountRow[];
  facility: { id: number; name: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const tally = useRef({ recorded: 0, same: 0, skipped: 0 });
  const row = rows[index];

  const finish = () => {
    const t = tally.current;
    toast(
      `شمارش تمام شد · ${faNum(t.recorded)} مورد با تفاوت، ${faNum(t.same)} مورد درست${t.skipped ? `، ${faNum(t.skipped)} مورد شمرده نشد` : ""}`,
      "success",
    );
    onClose();
  };

  if (!row) return null;
  return (
    <CountOne
      key={row.product_id}
      open={open}
      row={row}
      facility={facility}
      position={index + 1}
      total={rows.length}
      onResult={(kind) => {
        tally.current[kind] += 1;
      }}
      onAdvance={() => (index + 1 >= rows.length ? finish() : setIndex((i) => i + 1))}
      onUndo={() => {
        tally.current.recorded = Math.max(0, tally.current.recorded - 1);
        setIndex(index);
      }}
      onWritten={() => router.refresh()}
      onClose={onClose}
    />
  );
}

function CountOne({
  open, row, facility, position, total, onResult, onAdvance, onUndo, onWritten, onClose,
}: {
  open: boolean;
  row: CountRow;
  facility: { id: number; name: string };
  position: number;
  total: number;
  onResult: (kind: "recorded" | "same" | "skipped") => void;
  onAdvance: () => void;
  onUndo: () => void;
  onWritten: () => void;
  onClose: () => void;
}) {
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "stock_count",
      vars: {
        product: row.name,
        product_id: String(row.product_id),
        facility_id: String(facility.id),
        facility: facility.name,
        expected: String(row.expected),
        expected_label: `${fmt(row.expected)} ${row.base_unit}`,
        count: String(row.expected),
        count_unit: row.base_unit,
        unit: row.base_unit,
      },
    }),
    [row, facility],
  );

  const { state, setState, onSaved } = useFlowHost(stockCountFlow, ctx, {
    send: async (st) => {
      const movement = countMovement(ctx, st);
      if (!movement) return { ok: true };
      const res = await fetch("/api/sales/stock/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(movement),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `شمارش ثبت شد · ${countChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onWritten,
    onReopen: onUndo,
  });

  /* The "فرق" line under the reason question needs the typed number, which only the flow's
     state has; the render-only ctx carries it. */
  const viewCtx = useMemo<FlowContext>(() => {
    const counted = state.values.count !== undefined ? Number(state.values.count) : null;
    return counted === null
      ? ctx
      : {
          ...ctx,
          vars: {
            ...ctx.vars,
            diff_line: `شمارش ${fmt(counted)} ${row.base_unit}؛ فرق ${fmt(countDiff(counted, row.expected))}`,
          },
        };
  }, [ctx, state.values.count, row]);

  const save = (st: typeof state) => {
    if (countWritesNothing(st)) onResult(st.values.skipped === "1" ? "skipped" : "same");
    else {
      onResult("recorded");
      onSaved(st);
    }
    onAdvance();
  };

  return (
    <TapFlow
      open={open}
      title={`شمارش انبار · ${faNum(position)} از ${faNum(total)}`}
      subtitle={facility.name}
      config={stockCountFlow}
      ctx={viewCtx}
      state={state}
      onState={setState}
      onSaved={save}
      onClose={onClose}
      done={null}
    />
  );
}
