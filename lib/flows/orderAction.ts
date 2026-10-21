import type { FlowConfig, FlowContext, FlowOption, FlowState } from "@/lib/crm/flows/types";
import type { OrderAction } from "@/lib/orderStateMachine";
import type { ReasonDomain } from "@/lib/repo/reasonCodes";

/** Moving an order along its lifecycle.
 *
 *  Most actions are one tap and nothing else: they save, and the 5 s undo is the safety net (no
 *  "are you sure?"). The three that END something -- cancel, return, failed delivery -- first ask
 *  WHY, from the organisation's own reason list, because "why was this lost?" is the question
 *  reports are built on. The reason is optional on the server, so «دلیل مشخص نیست» is an honest
 *  answer, not a way around a rule.
 *
 *  Contract: vars.action, vars.reasons ("loading"|"ready"); ctx.items = the reason codes
 *  (id = reason_code id); values.reason_code_id. */
export const ACTION_LABEL: Record<OrderAction, string> = {
  submit: "ارسال برای بررسی",
  passReview: "تأیید سفارش",
  flagCredit: "—",
  approveCredit: "تأیید اعتبار",
  rejectCredit: "رد اعتبار",
  releaseHold: "رفع توقف سفارش",
  plan: "برنامه‌ریزی",
  unplan: "بازگشت به تأییدشده",
  freeze: "قطعی‌کردن مسیر",
  startRoute: "شروع مسیر",
  deliver: "ثبت تحویل کامل",
  deliverPartial: "ثبت تحویل ناقص",
  failDelivery: "ثبت تحویل ناموفق",
  retryDelivery: "برنامه‌ریزی مجدد",
  settle: "بستن سفارش",
  cancel: "لغو سفارش",
  returnOrder: "ثبت مرجوعی",
};

/** Actions that end something, and the list of reasons each one draws from. */
export const REASON_DOMAIN: Partial<Record<OrderAction, ReasonDomain>> = {
  cancel: "order_cancel",
  returnOrder: "order_return",
  failDelivery: "delivery_fail",
};

export const needsReason = (action: OrderAction): boolean => action in REASON_DOMAIN;

export const orderActionFlow: FlowConfig = {
  id: "order_action",
  start: () => "reason",
  budget: { common: 1, longest: 1 },
  steps: {
    reason: {
      id: "reason",
      kind: "choice",
      q: "چرا؟",
      sub: "{action_label}",
      options: (ctx: FlowContext): FlowOption[] => {
        if (ctx.vars.reasons === "loading") return [{ id: "wait", label: "در حال بارگذاری…", next: "reason" }];
        return [
          ...(ctx.items ?? []).map((r): FlowOption => ({
            id: `r${r.id}`,
            label: r.label,
            tone: "bad",
            save: true,
            put: { reason_code_id: String(r.id), reason_label: r.label },
          })),
          { id: "none", label: "دلیل مشخص نیست", save: true },
        ];
      },
    },
  },
};

/** The body POST /api/sales/orders/:id/transition expects. */
export function actionBody(action: OrderAction, st?: Pick<FlowState, "values">) {
  const id = st?.values.reason_code_id;
  return { action, reason_code_id: id ? Number(id) : null, note: null };
}

/** The toast line: what happened, and why when a reason was given. */
export function actionSummary(action: OrderAction, st?: Pick<FlowState, "values">): string {
  const why = st?.values.reason_label;
  return `${ACTION_LABEL[action]} ثبت شد${why ? ` · ${why}` : ""}`;
}
