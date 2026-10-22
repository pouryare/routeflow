/** Single-row visibility checks that run the caller's own scope fragment against one row, so the
 *  list and the detail go through one definition of who-sees-what and cannot drift. */

import { getDb } from "@/lib/db";

type Scope = { sql: string; params: (string | number)[] };

export function orderVisible(scope: Scope, orderId: number): boolean {
  return !!getDb().prepare(`SELECT o.id FROM orders o WHERE o.id = ?${scope.sql}`).get(orderId, ...scope.params);
}

export function customerVisible(scope: Scope, customerId: number): boolean {
  return !!getDb().prepare(`SELECT id FROM customers WHERE id = ?${scope.sql}`).get(customerId, ...scope.params);
}
