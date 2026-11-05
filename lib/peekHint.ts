/** The swipe hint: the first swipe row of each kind of list (orders, tasks, notifications) slides open a little
 *  and back, once, so a person learns the row can be swiped. Remembered on the device.
 *  shortcut: kept in localStorage (per device, not per account); move to users.prefs_json if people share phones. */

export type PeekKind = "orders" | "tasks" | "notifications";

const KEY = "rf_peek_seen_";
/** Kinds already claimed by a row on this page, so only the first row of a list peeks. */
const claimed = new Set<PeekKind>();

type Store = Pick<Storage, "getItem" | "setItem">;

/** True once per kind and device: the caller plays the hint. Marks it seen at the same time. */
export function claimPeek(kind: PeekKind, store: Store | null): boolean {
  if (claimed.has(kind)) return false;
  claimed.add(kind);
  try {
    if (!store || store.getItem(KEY + kind)) return false;
    store.setItem(KEY + kind, "1");
    return true;
  } catch {
    // Private mode and blocked site data both throw on access: no hint rather than a hint every time.
    return false;
  }
}
