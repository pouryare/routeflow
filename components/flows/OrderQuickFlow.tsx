"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import DateStep from "@/components/tapflow/DateStep";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import {
  itemsFromLastOrder, orderChips, orderLastSummary, orderQuickFlow, orderRequest, pickLastOrder,
  type CatalogueProduct,
} from "@/lib/flows/orderQuick";
import { faNum } from "@/lib/format";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";

export interface QuickCustomer {
  id: number;
  customer_code: string;
  business_name: string;
  debt: number;
  credit_limit_toman: number | null;
}

type Last = { for: number; status: "ready" | "none"; items: NonNullable<FlowContext["items"]>; summary: string };

const FAILURE = "سفارش ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** A repeat order as a tap flow (docs/tap-flow-principles.md §7: «Order quick path»).
 *
 *  Reads the customer's most recent real order and offers it back; the order is created as a
 *  DRAFT through the same endpoint as the full form, and confirmed on the order's own page.
 *  «سفارش تازه» hands over to the full form (`onFull`), which is the only way for a shop with no
 *  history.
 *
 *  Mount it with a fresh `key` each time it opens: that is what re-seeds the flow. */
export default function OrderQuickFlow({
  open,
  customers,
  products,
  customerId,
  onFull,
  onClose,
  onReopen,
}: {
  open: boolean;
  customers: QuickCustomer[];
  products: CatalogueProduct[];
  customerId?: number | null;
  /** Leave for the full form. Defaults to navigating there with the customer selected. */
  onFull?: (customerId: number | null) => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const router = useRouter();
  const today = useMemo(() => tehranTodayIso(), []);
  const createdId = useRef<number | null>(null);
  const [last, setLast] = useState<Last | null>(null);

  /* The customer is fixed by the screen or picked in the flow's first question; the flow's own
     state is read below, once the host exists, so the fetch is keyed on it. */
  const [picked, setPicked] = useState<number | null>(null);
  const who = customerId ?? picked;

  useEffect(() => {
    if (who === null) return;
    let alive = true;
    (async () => {
      try {
        const list = (await (await fetch(`/api/sales/orders?customer=${who}&limit=10`)).json()) as {
          orders?: { id: number; status: string; order_date: string }[];
        };
        const o = pickLastOrder(list.orders ?? []);
        if (!o) {
          if (alive) setLast({ for: who, status: "none", items: [], summary: "" });
          return;
        }
        const detail = (await (await fetch(`/api/sales/orders/${o.id}`)).json()) as {
          order?: { lines: { product_id: number; packaging_id: number; packs_ordered: number; is_reversal?: number }[] };
        };
        const { items, dropped } = itemsFromLastOrder(detail.order?.lines ?? [], products);
        if (!alive) return;
        if (items.length === 0) {
          setLast({ for: who, status: "none", items: [], summary: "" });
          return;
        }
        const total = items.reduce((s, i) => s + (i.qty ?? 0) * (i.price ?? 0), 0);
        const recap = orderLastSummary(faJalaliDate(o.order_date), items.map((i) => ({ label: i.label.split(" · ")[0], packs: i.qty ?? 0 })), total);
        setLast({
          for: who,
          status: "ready",
          items,
          summary: dropped > 0 ? `${recap} · ${faNum(dropped)} قلم دیگر قابل سفارش نیست` : recap,
        });
      } catch {
        if (alive) setLast({ for: who, status: "none", items: [], summary: "" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [who, products]);

  const ctx = useMemo<FlowContext>(() => {
    const c = customers.find((x) => x.id === who);
    const mine = last && last.for === who ? last : null;
    return {
      ...EMPTY_CONTEXT,
      entry: "order_quick",
      recentCustomers: customers.map((x) => ({ id: x.id, name: `${x.business_name} (${x.customer_code})` })),
      items: mine?.items ?? [],
      vars: {
        today,
        last: who === null ? "loading" : mine ? mine.status : "loading",
        last_summary: mine?.summary ?? "",
        ...(c ? { customer_id: String(c.id), customer: c.business_name, debt: String(c.debt) } : {}),
        ...(c?.credit_limit_toman != null ? { credit_limit: String(c.credit_limit_toman) } : {}),
      },
    };
  }, [customers, who, last, today]);

  const { state, setState, onSaved, flush } = useFlowHost(orderQuickFlow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderRequest(ctx, st)),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!res.ok) return { ok: false, error: json.error };
      createdId.current = json.id ?? null;
      return { ok: true };
    },
    summary: (st) => `سفارش ثبت شد · ${orderChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onReopen,
  });

  /* A picked customer starts the fetch above. The flow's own answer is the source of truth. */
  const whoFromFlow = state.values.who ? Number(state.values.who) : null;
  if (customerId == null && whoFromFlow !== picked) setPicked(whoFromFlow); // adjusted during render, not in an effect

  const exitFull = state.saved && state.values.exit === "full";
  const save = (st: FlowState) => {
    if (st.values.exit === "full") {
      onClose();
      const id = customerId ?? (st.values.who ? Number(st.values.who) : null);
      if (onFull) onFull(id);
      else router.push(id ? `/sales/orders/new?customer=${id}` : "/sales/orders/new");
      return; // nothing is sent: this answer only chooses the other form
    }
    onSaved(st);
  };

  const renderCustom = (api: CustomStepApi) =>
    api.step.kind === "date" ? (
      <DateStep
        optionId={api.step.options[0].id}
        optionLabel={api.step.options[0].label}
        from={today}
        presets={[]}
        ariaLabel="روز تحویل"
        submit={api.submit}
      />
    ) : null;

  return (
    <TapFlow
      open={open}
      title="سفارش سریع"
      subtitle={ctx.vars.customer}
      config={orderQuickFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={save}
      onClose={onClose}
      renderCustom={renderCustom}
      done={
        exitFull ? null : (
          <FlowDone
            key={state.answers.length}
            chips={orderChips(ctx, state)}
            actions={
              <button
                type="button"
                className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid"
                onClick={async () => {
                  await flush();
                  if (createdId.current) router.push(`/sales/orders/${createdId.current}`);
                }}
              >
                <Icon name="receipt" size="md" />
                باز کردن سفارش
              </button>
            }
            onReturn={onClose}
          />
        )
      }
    />
  );
}
