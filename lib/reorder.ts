/** Dragging a row to a new place in a list. Pure: the component measures, these decide. */

/** Move the item at `from` so it ends up at index `to` (both in the ORIGINAL list), returning a new
 *  list. Out-of-range or equal indices return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Which slot the pointer is over: the index of the first row whose vertical midpoint is below `y`,
 *  or the last index when `y` is below every midpoint. `mids` are the rows' centre Ys, top to bottom. */
export function slotAt(mids: readonly number[], y: number): number {
  if (mids.length === 0) return 0;
  for (let i = 0; i < mids.length; i++) if (y < mids[i]) return i;
  return mids.length - 1;
}
