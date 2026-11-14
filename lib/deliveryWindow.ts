import { WEEKDAY_LABEL, parseHours, satIndex } from "@/lib/crm/hours";
import { faDigits } from "@/lib/crm/vocab";

/** F57 first slice, display only: what the customer's working hours say about the day of a run, for the driver's stop card.
 *  Example: hours «شنبه تا چهارشنبه ۸ تا ۱۴» on a Sunday run give «۰۸:۰۰ تا ۱۴:۰۰»; on a Friday run «امروز بسته است».
 *  shortcut: opening hours stand in for receiving hours and are not given to the route solver; upgrade with a separate receiving window. */
export function windowLabel(hoursJson: string | null | undefined, isoDate: string): string | null {
  const hours = parseHours(hoursJson);
  if (hours.length === 0) return null;
  const dow = satIndex(new Date(`${isoDate}T12:00:00Z`).getUTCDay());
  const today = hours.filter((r) => r.days.includes(dow));
  if (today.length === 0) return `${WEEKDAY_LABEL[dow]} بسته است`;
  return today.map((r) => `${faDigits(r.from)} تا ${faDigits(r.to)}`).join(" و ");
}
