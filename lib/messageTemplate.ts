/* F136 first slice: a company's own wording for a notification type. «{order_no}» style placeholders are filled from the event; an unknown
 * placeholder, an empty title or a too-long text makes the override invalid, and the shipped text is used instead.
 * Example: title «سفارش {order_no} تأیید شد» + order_no 1042 -> «سفارش 1042 تأیید شد». */
const ORDER = ["order_no", "customer_name"];
export const TEMPLATE_PLACEHOLDERS: Record<string, readonly string[]> = {
  "task.assigned": ["title"],
  "task.escalated": ["title"],
  "task.due_soon": ["title"],
  "order.confirmed": ORDER,
  "order.rejected": ORDER,
  "order.created": ORDER,
  "delivery.succeeded": ORDER,
  "delivery.failed": ORDER,
  "payment.recorded": ["customer_name", "amount_toman"],
  "credit_approval.waiting": ["customer_name"],
  "customer.overdue": ["customer_name"],
  "cheque.due_soon": ["cheque_no", "due_date"],
  "reminder.due": ["message"],
};
export const TITLE_MAX = 80;
export const BODY_MAX = 240;

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** The problem with a wording, in words for the owner; null when it can be saved. */
export function templateProblem(typeCode: string, title: string, body: string | null): string | null {
  const allowed = TEMPLATE_PLACEHOLDERS[typeCode];
  if (!allowed) return "این نوع اعلان قابل تغییر نیست";
  if (!title.trim()) return "عنوان خالی است";
  if (title.length > TITLE_MAX) return `عنوان حداکثر ${TITLE_MAX} نویسه است`;
  if (body && body.length > BODY_MAX) return `متن حداکثر ${BODY_MAX} نویسه است`;
  for (const text of [title, body ?? ""]) {
    for (const m of text.matchAll(PLACEHOLDER)) if (!allowed.includes(m[1])) return `«{${m[1]}}» برای این اعلان وجود ندارد`;
  }
  return null;
}

/** Fills the placeholders; a value the event did not carry becomes empty. Null when the wording is invalid, so the caller keeps the shipped text. */
export function fillTemplate(typeCode: string, title: string, body: string | null, values: Record<string, string | null>): { title_fa: string; body_fa: string | null } | null {
  if (templateProblem(typeCode, title, body)) return null;
  const fill = (s: string) => s.replace(PLACEHOLDER, (_m, k: string) => values[k] ?? "").replace(/\s{2,}/g, " ").trim();
  const t = fill(title);
  return t ? { title_fa: t, body_fa: body ? fill(body) || null : null } : null;
}
