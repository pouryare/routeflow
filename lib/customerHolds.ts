/** F71: a temporary hold on a customer's new orders. Pure rules.
 *  Example: a rep places a hold on «نانوایی سحر» for 7 days because a cheque bounced; a new order from them waits for a manager. */
export const HOLD_DEFAULT_DAYS = 7;
const HOLD_MAX_DAYS = 30;

export function holdProblem(i: { reason: string; expiresOn: string; today: string }): string | null {
  if (i.reason.trim().length === 0) return "دلیل نگه‌داشتن را بنویسید";
  if (i.reason.length > 200) return "دلیل از ۲۰۰ نویسه بیشتر است";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn) || i.expiresOn < i.today) return "تاریخ پایان باید امروز یا بعد از آن باشد";
  const days = (Date.parse(`${i.expiresOn}T00:00:00Z`) - Date.parse(`${i.today}T00:00:00Z`)) / 86_400_000;
  if (days > HOLD_MAX_DAYS) return `نگه‌داشتن بیش از ${HOLD_MAX_DAYS.toLocaleString("fa-IR")} روز ممکن نیست`;
  return null;
}

/** A hold is in force on its last day too, so it lapses the morning after. */
export const holdActive = (h: { expires_on: string; released_at: string | null }, today: string): boolean => h.released_at === null && h.expires_on >= today;

/** The placer takes it back; any manager or the owner may release any hold. */
export const canReleaseHold = (who: { userId: number; manager: boolean }, h: { placed_by: number }): boolean => who.manager || who.userId === h.placed_by;
