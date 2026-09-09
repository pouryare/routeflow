/** Positions a small tree of complaint-resolution steps for rendering -- row = depth
 *  from its root, col = horizontal slot. Deliberately simple (these graphs are a
 *  handful of nodes, never hundreds): leaves get the next integer column left to
 *  right in traversal order, and a parent's column is the average of its children's,
 *  the same "centre over your children" rule most small org-chart layouts use. */
export interface LayoutNode {
  id: number;
  row: number;
  col: number;
  parentId: number | null;
}

export function layoutTree(
  taskIds: number[],
  edges: { from_task_id: number; to_task_id: number }[],
): LayoutNode[] {
  const parentOf = new Map<number, number>();
  const childrenOf = new Map<number, number[]>();
  for (const e of edges) {
    parentOf.set(e.to_task_id, e.from_task_id);
    const list = childrenOf.get(e.from_task_id) ?? [];
    list.push(e.to_task_id);
    childrenOf.set(e.from_task_id, list);
  }

  const roots = taskIds.filter((id) => !parentOf.has(id));
  const row = new Map<number, number>();
  const col = new Map<number, number>();
  let nextLeafCol = 0;

  // Depth-first, root to leaf: row is trivial (parent's row + 1); col is assigned on
  // the way back UP (a leaf claims the next slot, a parent averages its children) --
  // so children must be visited, and given a column, before their parent is.
  function visit(id: number, depth: number, seen: Set<number>) {
    if (seen.has(id)) return; // defensive: the DB shape can never cycle, but stay safe
    seen.add(id);
    row.set(id, depth);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      col.set(id, nextLeafCol);
      nextLeafCol += 1;
      return;
    }
    for (const kid of kids) visit(kid, depth + 1, seen);
    const kidCols = kids.map((k) => col.get(k) ?? 0);
    col.set(id, kidCols.reduce((a, b) => a + b, 0) / kidCols.length);
  }

  const seen = new Set<number>();
  for (const rootId of roots) visit(rootId, 0, seen);

  return taskIds.map((id) => ({
    id,
    row: row.get(id) ?? 0,
    col: col.get(id) ?? 0,
    parentId: parentOf.get(id) ?? null,
  }));
}
