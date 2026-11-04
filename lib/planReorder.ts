/** The sort_order changes that put a day's stops in `newIds` order. The existing sort_order values are
 *  dealt out again in the new order, so only the stops that moved change; when the existing values are
 *  not strictly increasing (a fresh day can hold all zeros) the day is numbered 1, 2, 3 instead. */
export function reorderPatches(
  plans: { id: number; sort_order: number }[],
  newIds: number[],
): { id: number; sort_order: number }[] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const ids = newIds.filter((id) => byId.has(id));
  const values = [...plans].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map((p) => p.sort_order);
  const strict = values.every((v, i) => i === 0 || v > values[i - 1]);
  const targets = strict ? values : values.map((_, i) => i + 1);
  return ids.flatMap((id, i) => (byId.get(id)!.sort_order === targets[i] ? [] : [{ id, sort_order: targets[i] }]));
}
