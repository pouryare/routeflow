/** Web-push device endpoints. user_id is what makes a subscription addressable; it is re-stamped on
 *  conflict so a shared or recycled endpoint follows whoever registered it last. */

import { getDb } from "@/lib/db";

export function saveSubscription(endpoint: string, p256dh: string, auth: string, userId: number): void {
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id`
    )
    .run(endpoint, p256dh, auth, new Date().toISOString(), userId);
}

/** Scoped to the caller so a guessed endpoint cannot unsubscribe someone else's device. `user_id IS NULL`
 *  keeps rows registered before the column existed deletable by whoever holds that endpoint. */
export function removeSubscription(endpoint: string, userId: number): void {
  getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id IS NULL OR user_id = ?)").run(endpoint, userId);
}
