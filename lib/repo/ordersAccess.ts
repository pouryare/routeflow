/** Single-row visibility checks that run the caller's own scope fragment against one row, so the
 *  list and the detail go through one definition of who-sees-what and cannot drift. */

import { getDb } from "@/lib/db";

type Scope = { sql: string; params: (string | number)[] };

export async function orderVisible(scope: Scope, orderId: number): Promise<boolean> {
  return !!await getDb().prepare(`SELECT o.id FROM orders o WHERE o.id = ?${scope.sql}`).get(orderId, ...scope.params);
}

export async function customerVisible(scope: Scope, customerId: number): Promise<boolean> {
  return !!await getDb().prepare(`SELECT id FROM customers WHERE id = ?${scope.sql}`).get(customerId, ...scope.params);
}
