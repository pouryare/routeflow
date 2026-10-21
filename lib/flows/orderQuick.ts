import type { FlowConfig, FlowContext, FlowOption } from "@/lib/crm/flows/types";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { roundToman } from "@/lib/money";
import { resolveRequestedDay } from "@/lib/requestedDay";
import { addDaysIso } from "@/lib/flows/dates";

/** A repeat order: «same as last time?», adjust if not, pick the delivery day, confirm.
 *
 *  Most shops buy nearly the same thing again, so the first screen shows what last time was and
 *  the common answer is one tap. Quantities start on last time's and may go UP as well as down
 *  (`item.max`). The full form stays one tap away («سفارش تازه»), and is the only way for a shop
 *  with no history.
 *
 *  Items are catalogue lines: `id` = packaging id, `parent` = product id, `qty` = last time's
 *  packs, `price` = the CURRENT price per pack (the server prices the order itself; this is for
 *  the total on screen).
 *
 *  Keys, the contract with `orderRequest`:
 *    who          picked customer id
 *    adjust       JSON { [packagingId]: packs } from the stepper
 *    requested_kind / requested_day   from the day chips
 *    day_pick     a calendar day (exact date)
 *    exit         "full": leave for the full form, send nothing
 *  vars: today, customer_id, customer, last ("ready"|"none"|"loading"), last_summary,
 *        debt, credit_limit (toman, optional) */
type Vals = { values: Record<string, string> };

const num = (v: string | undefined): number => (v ? Number(v) : 0);

export function orderCounts(ctx: FlowContext, st: Vals): Record<number, number> {
  const items = ctx.items ?? [];
  if (st.values.adjust) {
    const said = JSON.parse(st.values.adjust) as Record<string, number>;
    return Object.fromEntries(items.map((i) => [i.id, Number(said[i.id] ?? 0)]));
  }
  return Object.fromEntries(items.map((i) => [i.id, i.qty ?? 0]));
}

/** Lines to send: those with at least one pack. */
export function orderLines(ctx: FlowContext, st: Vals) {
  const counts = orderCounts(ctx, st);
  return (ctx.items ?? [])
    .filter((i) => (counts[i.id] ?? 0) > 0)
    .map((i) => ({ product_id: i.parent as number, packaging_id: i.id, packs: counts[i.id] }));
}

export function orderTotal(ctx: FlowContext, st: Vals): number {
  const counts = orderCounts(ctx, st);
  return (ctx.items ?? []).reduce((sum, i) => sum + roundToman((counts[i.id] ?? 0) * (i.price ?? 0)), 0);
}

function requestedOf(st: Vals): { day: string | null; kind: "soonest" | "exact_date" | "week_offset" } {
  if (st.values.day_pick) return { day: st.values.day_pick, kind: "exact_date" };
  const kind = (st.values.requested_kind as "soonest" | "exact_date" | "week_offset" | undefined) ?? "soonest";
  return { day: st.values.requested_day ? st.values.requested_day : null, kind };
}

/** Over the customer's credit limit? A warning and a recorded override, never a block: the debt
 *  figures lag reality, and refusing a real sale over a stale number is worse than noting it. */
export function overCreditLimit(ctx: FlowContext, st: Vals): boolean {
  const limit = ctx.vars.credit_limit ? Number(ctx.vars.credit_limit) : null;
  return limit !== null && num(ctx.vars.debt) + orderTotal(ctx, st) > limit;
}

export function orderLastSummary(dateLabel: string, lines: { label: string; packs: number }[], total: number): string {
  return `آخرین سفارش ${dateLabel} · ${lines.map((l) => `${l.label} ${faNum(l.packs)}`).join("، ")} · ${faToman(total)}`;
}

const dayOption = (id: string, label: string, today: string, offset: number): FlowOption => {
  const day = addDaysIso(today, offset);
  return { id, label, sub: faJalaliDate(day), next: "confirm", put: { requested_kind: "exact_date", requested_day: day } };
};

export const orderQuickFlow: FlowConfig = {
  id: "order_quick",
  start: (ctx) => (ctx.vars.customer_id ? "same" : "who"),
  budget: { common: 4, longest: 6 },
  steps: {
    who: {
      id: "who",
      kind: "pick",
      q: "سفارش برای کدام مشتری است؟",
      choices: (ctx) => ctx.recentCustomers.map((c) => ({ id: String(c.id), label: c.name })),
      options: [{ id: "pick", label: "ادامه", next: "same" }],
    },
    same: {
      id: "same",
      kind: "choice",
      q: "سفارش چطور باشد؟",
      sub: (ctx) =>
        ctx.vars.last === "ready" ? ctx.vars.last_summary
        : ctx.vars.last === "loading" ? "در حال خواندن سفارش قبلی…"
        : "این مشتری سفارش قبلی ندارد؛ با فرم کامل ثبت کنید.",
      options: (ctx): FlowOption[] => {
        const full: FlowOption = {
          id: "full",
          label: "سفارش تازه (فرم کامل)",
          sub: "فرم کامل باز می‌شود",
          save: true,
          put: { exit: "full" },
        };
        if (ctx.vars.last === "loading") return [{ id: "wait", label: "در حال بارگذاری…", next: "same" }];
        if (ctx.vars.last !== "ready") return [full];
        return [
          { id: "yes", label: "همان سفارش قبلی", sub: "تعداد همان قبلی است", tone: "rec", next: "day" },
          { id: "change", label: "تغییر می‌دهم", sub: "تعداد هر قلم را اصلاح می‌کنید", next: "adjust" },
          full,
        ];
      },
    },
    adjust: {
      id: "adjust",
      kind: "stepper",
      q: "از هر قلم چند بسته؟",
      options: [
        {
          id: "ok",
          label: "ادامه",
          tone: "rec",
          next: (ctx, s) => (orderLines(ctx, s).length > 0 ? "day" : "empty"),
        },
      ],
    },
    empty: {
      id: "empty",
      kind: "choice",
      q: "هیچ قلمی باقی نمانده",
      sub: "سفارش بدون قلم ثبت نمی‌شود.",
      options: [{ id: "back", label: "برگشت و اصلاح", next: "adjust" }],
    },
    day: {
      id: "day",
      kind: "choice",
      q: "کی تحویل شود؟",
      options: (ctx): FlowOption[] => {
        const today = ctx.vars.today;
        const week = resolveRequestedDay("week_offset", 1, today);
        return [
          { id: "soonest", label: "در اولین فرصت", sub: "روز مشخصی قول داده نشده", tone: "rec", next: "confirm", put: { requested_kind: "soonest", requested_day: "" } },
          dayOption("tomorrow", "فردا", today, 1),
          dayOption("after", "پس‌فردا", today, 2),
          { id: "week", label: "هفتهٔ بعد", sub: faJalaliDate(week), next: "confirm", put: { requested_kind: "week_offset", requested_day: week } },
          { id: "other", label: "روز دیگر…", next: "day_pick" },
        ];
      },
    },
    day_pick: {
      id: "day_pick",
      kind: "date",
      q: "تحویل چه روزی باشد؟",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "confirm" }],
    },
    confirm: {
      id: "confirm",
      kind: "choice",
      q: "سفارش ثبت شود؟",
      sub: (ctx, s) => {
        const lines = orderLines(ctx, s);
        const parts = [`${faNum(lines.length)} قلم · جمع ${faToman(orderTotal(ctx, s))}`];
        if (overCreditLimit(ctx, s)) {
          parts.push(`سقف اعتبار ${faToman(Number(ctx.vars.credit_limit))} رد می‌شود؛ با ثبت، به‌عنوان استثنا ثبت می‌شود.`);
        }
        parts.push("سفارش به‌صورت پیش‌نویس ثبت می‌شود و در صفحهٔ سفارش تأیید می‌شود.");
        return parts.join(" · ");
      },
      options: [{ id: "ok", label: "ثبت سفارش", tone: "rec", save: true }],
    },
  },
};

/** The exact body POST /api/sales/orders expects. The order is created as a DRAFT. */
export function orderRequest(ctx: FlowContext, st: Vals) {
  const { day, kind } = requestedOf(st);
  return {
    customer_id: Number(ctx.vars.customer_id ?? st.values.who),
    order_date: ctx.vars.today,
    requested_day: day,
    requested_kind: kind,
    salesperson_user_id: null,
    notes: null,
    credit_override: overCreditLimit(ctx, st),
    lines: orderLines(ctx, st),
  };
}

/** Every recorded fact for the done screen, including the delivery day that was used. */
export function orderChips(ctx: FlowContext, st: Vals): string[] {
  const id = Number(ctx.vars.customer_id ?? st.values.who);
  const name = ctx.vars.customer ?? ctx.recentCustomers.find((c) => c.id === id)?.name;
  const { day, kind } = requestedOf(st);
  return [
    ...(name ? [name] : []),
    `${faNum(orderLines(ctx, st).length)} قلم`,
    `جمع ${faToman(orderTotal(ctx, st))}`,
    kind === "soonest" || day === null ? "تحویل: در اولین فرصت" : `تحویل: ${faJalaliDate(day)}`,
    "پیش‌نویس",
  ];
}
