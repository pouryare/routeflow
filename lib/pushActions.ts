import type { ChequeStatus } from "@/lib/chequeStates";

/** A one-tap action on a push notification: a button under the notification that does the obvious
 *  thing without opening the app. Only for a notification that is about exactly ONE thing the
 *  person can act on (the pushes are digests, so a digest of several things has no single target
 *  and gets no button). The service worker runs `request` with the signed-in cookie, and refuses
 *  anything that is not a relative /api/ path. */
export interface PushAction {
  /** Label under the notification. */
  title: string;
  /** What the service worker sends when it is tapped. */
  request: { url: string; method: "PATCH" | "POST"; body: Record<string, unknown> };
  /** Said back to the person once it worked. */
  done: string;
}

export function pushActionFor(
  n: { type_code: string; entity_type: string | null; entity_id: number | null; ref_id?: number | null },
  chequeStatus: ChequeStatus | null,
): PushAction | null {
  if (n.type_code === "cheque.due_soon" && n.entity_type === "cheque" && n.entity_id !== null) {
    // The move the server offers next from where the cheque is: in hand -> deposited -> cleared.
    const to: ChequeStatus | null = chequeStatus === "in_hand" ? "deposited" : chequeStatus === "deposited" ? "cleared" : null;
    if (!to) return null;
    return {
      title: to === "deposited" ? "به بانک سپرده شد" : "وصول شد",
      request: { url: `/api/cheques/${n.entity_id}`, method: "PATCH", body: { action: "advance", to } },
      done: to === "deposited" ? "چک سپرده شد" : "چک وصول شد",
    };
  }
  // A due reminder: «انجام شد» resolves that reminder (ref_id), not the customer it is about.
  if (n.type_code === "reminder.due" && n.ref_id != null) {
    return {
      title: "انجام شد",
      request: { url: `/api/reminders/${n.ref_id}`, method: "PATCH", body: { resolved: true } },
      done: "یادآوری انجام شد",
    };
  }
  return null;
}

/** The only requests the service worker will make on a notification's behalf. */
export const isAllowedPushRequest = (url: string): boolean => /^\/api\/[A-Za-z0-9/_-]+$/.test(url);
