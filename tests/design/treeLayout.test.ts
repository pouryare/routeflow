import { describe, expect, it } from "vitest";
import { layoutTree } from "@/lib/design/treeLayout";

describe("layoutTree", () => {
  it("a single root with no edges sits at row 0, col 0", () => {
    const out = layoutTree([1], []);
    expect(out).toEqual([{ id: 1, row: 0, col: 0, parentId: null }]);
  });

  it("a chain descends one row per link", () => {
    const out = layoutTree(
      [1, 2, 3],
      [
        { from_task_id: 1, to_task_id: 2 },
        { from_task_id: 2, to_task_id: 3 },
      ],
    );
    expect(out.find((n) => n.id === 1)).toMatchObject({ row: 0, parentId: null });
    expect(out.find((n) => n.id === 2)).toMatchObject({ row: 1, parentId: 1 });
    expect(out.find((n) => n.id === 3)).toMatchObject({ row: 2, parentId: 2 });
  });

  it("two children of the same root sit on the same row, at different columns", () => {
    const out = layoutTree(
      [1, 2, 3],
      [
        { from_task_id: 1, to_task_id: 2 },
        { from_task_id: 1, to_task_id: 3 },
      ],
    );
    const a = out.find((n) => n.id === 2)!;
    const b = out.find((n) => n.id === 3)!;
    expect(a.row).toBe(1);
    expect(b.row).toBe(1);
    expect(a.col).not.toBe(b.col);
  });

  it("a parent's column centres over its children's columns", () => {
    const out = layoutTree(
      [1, 2, 3],
      [
        { from_task_id: 1, to_task_id: 2 },
        { from_task_id: 1, to_task_id: 3 },
      ],
    );
    const root = out.find((n) => n.id === 1)!;
    const a = out.find((n) => n.id === 2)!;
    const b = out.find((n) => n.id === 3)!;
    expect(root.col).toBeCloseTo((a.col + b.col) / 2);
  });

  it("multiple independent roots each start their own subtree", () => {
    const out = layoutTree([1, 2], []);
    expect(out.find((n) => n.id === 1)?.row).toBe(0);
    expect(out.find((n) => n.id === 2)?.row).toBe(0);
    expect(out.find((n) => n.id === 1)?.col).not.toBe(out.find((n) => n.id === 2)?.col);
  });
});
