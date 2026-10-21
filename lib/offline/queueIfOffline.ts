import { getSyncEngine } from "./syncEngine";
import { postJSON } from "./net";

/** The one line a flow's `send` needs to be offline-safe: with no signal, an allowlisted FACT
 *  (receipt, cheque, complaint, delivery) goes into the device outbox and is sent on reconnect.
 *  Returns true when it was queued (the caller reports success and tells the person), false when
 *  the device is online or the outbox refused, so the caller makes its normal request. */
export async function queueIfOffline(url: string, body: Record<string, unknown>): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return false;
  try {
    const r = await postJSON(url, body, getSyncEngine().outbox);
    return r.queued === true;
  } catch {
    return false;
  }
}

export const QUEUED_MESSAGE = "اینترنت قطع است؛ روی گوشی ذخیره شد و به‌محض اتصال ارسال می‌شود.";
