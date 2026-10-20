/** One question before an action that cannot be quietly undone.
 *
 *  Cancelling an order, deleting a place or photo, and deactivating an account each took a
 *  single click: a slip of the thumb on a phone was enough, and nothing said so afterwards.
 *  The account switcher already asks with the browser's own dialog, so the rest do the same
 *  rather than introducing a second pattern. Returns false when there is no window to ask in. */
export function confirmAction(message: string): boolean {
  return typeof window !== "undefined" && window.confirm(message);
}
