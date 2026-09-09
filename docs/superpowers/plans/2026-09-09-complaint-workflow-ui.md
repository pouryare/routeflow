# Complaint Resolution Workflow — Graph UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The actual drag-to-link graph — spec §9c's connector visual language (curved
bezier edges, solid=resolved/dashed=pending), rendered on the backend PR#4 shipped, drag
mechanic adapted from this codebase's own proven pattern rather than invented fresh.

**Architecture:** A modal opened from a new button on each `/sales/complaints` row.
Two pieces of genuinely pure, testable logic (a tree layout algorithm and a bezier path
builder) are extracted into `lib/design/`, matching this session's established
discipline. The drag gesture itself — `components/sales/AssignmentBoard.tsx`'s
pointer-capture pattern, already proven touch-capable and already carrying a real
keyboard/click fallback — is adapted, not reinvented. The modal reuses the existing
`.kargah-scrim`/`.modal` CSS (`components/sales/ProcessingModal.tsx` is the reference),
not new modal chrome.

**Tech Stack:** React client component, native Pointer Events (no drag library), inline
SVG for the connector lines, Vitest for the two pure modules.

**Spec:** §9c's connector visual language; backend from
`docs/superpowers/plans/2026-09-09-complaint-workflow-backend.md` (PR#4).

## Global Constraints

- No drag library — this codebase already has a proven, hand-rolled, touch-capable
  pattern (`AssignmentBoard.tsx`); use it, don't add a dependency for something already
  solved here.
- Every drag interaction needs a non-drag fallback reachable by keyboard — matching
  `AssignmentBoard.tsx`'s `onPointerDown` + `onClick` dual-wire on one real `<button>`,
  distinguished by a `dragging` ref (a real click never fires after a drag exceeded the
  threshold).
- The modal reuses `.kargah-scrim`/`.modal` (Esc-to-close, focus-on-open, always
  rendered/hidden rather than conditionally mounted) — no new modal chrome pattern.
- No confirm-before-write step (unlike `AssignmentBoard.tsx`'s delivery-routing case) —
  spawning the wrong resolution step is low-stakes and reversible by dismissing the task
  through the existing flow; matching the video's snappy drop-creates interaction.
- This repo's working directory doubles as the live `routeflow` systemd service's
  `WorkingDirectory`. Before switching branches for the production-restore step, confirm
  `git status --porcelain -uall` is **completely** clean, not just `git status`.

---

### Task 1: `lib/design/treeLayout.ts` — pure tree layout

**Files:**
- Create: `lib/design/treeLayout.ts`
- Test: `tests/design/treeLayout.test.ts`

**Interfaces:**
- Produces: `layoutTree(taskIds: number[], edges: { from_task_id: number; to_task_id:
  number }[]): { id: number; row: number; col: number; parentId: number | null }[]`.
  Consumed by Task 3's modal to position each task node.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/design/treeLayout.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/design/treeLayout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/design/treeLayout.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/design/treeLayout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/design/treeLayout.ts tests/design/treeLayout.test.ts
git commit -m "feat: layoutTree -- pure row/col positioning for the complaint step graph"
```

---

### Task 2: `lib/design/connectorPath.ts` — pure bezier path builder

**Files:**
- Create: `lib/design/connectorPath.ts`
- Test: `tests/design/connectorPath.test.ts`

**Interfaces:**
- Produces: `bezierPath(from: { x: number; y: number }, to: { x: number; y: number }):
  string` — an SVG path `d` attribute value. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/design/connectorPath.test.ts
import { describe, expect, it } from "vitest";
import { bezierPath } from "@/lib/design/connectorPath";

describe("bezierPath", () => {
  it("starts at the from point and ends at the to point", () => {
    const d = bezierPath({ x: 10, y: 20 }, { x: 110, y: 220 });
    expect(d.startsWith("M 10 20")).toBe(true);
    expect(d.endsWith("110 220")).toBe(true);
  });

  it("is a single cubic bezier segment", () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(d).toMatch(/^M .+ C .+, .+, .+$/);
  });

  it("control points sit at the vertical midpoint -- an S-curve, not a straight elbow", () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 100, y: 200 });
    // mid-y = 100; both control points should reference it.
    expect(d).toContain(" 100 ");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/design/connectorPath.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/design/connectorPath.ts
/** A vertical S-curve between a parent step and a child step -- spec 2026-09-08 §9c's
 *  "curved bezier edges between task nodes." Control points sit at the vertical
 *  midpoint between the two nodes, offset horizontally toward each endpoint, which is
 *  what gives the curve its S shape rather than a straight diagonal line. */
export function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/design/connectorPath.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/design/connectorPath.ts tests/design/connectorPath.test.ts
git commit -m "feat: bezierPath -- pure SVG connector curve between two graph nodes"
```

---

### Task 3: `ComplaintWorkflowModal` — the graph UI

**Files:**
- Create: `components/sales/ComplaintWorkflowModal.tsx`

**Interfaces:**
- Consumes: `layoutTree` (Task 1), `bezierPath` (Task 2), `GET`/`POST
  /api/sales/complaints/[id]/steps` (PR#4), `PATCH /api/tasks/[id]` (existing),
  `useToast` (`components/ToastProvider.tsx`).
- Produces: `<ComplaintWorkflowModal complaintId={number | null} onClose={() => void}
  canManage={boolean} />`. Consumed by Task 4.

This is browser glue (fetch, drag, DOM) — not unit-tested directly, matching this
repo's established convention for `AssignmentBoard.tsx`/`NotificationBell.tsx`; verified
by the build and Task 7's real-browser check instead.

- [ ] **Step 1: Write the component**

```tsx
// components/sales/ComplaintWorkflowModal.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { layoutTree } from "@/lib/design/treeLayout";
import { bezierPath } from "@/lib/design/connectorPath";

interface StepTemplate {
  key: string;
  label_fa: string;
}
interface StepTask {
  id: number;
  title: string;
  status: string;
}
interface Edge {
  from_task_id: number;
  to_task_id: number;
}

const NODE_W = 150;
const NODE_H = 44;
const ROW_H = 84;
const COL_W = 170;

/** The drag-to-link resolution graph for one complaint -- spec 2026-09-08 §9c's
 *  connector language, on the backend PR shipped separately. Drag mechanic adapted
 *  from AssignmentBoard.tsx's proven pointer-capture pattern: a real <button> wired
 *  with BOTH onPointerDown (drag) and onClick (keyboard/tap fallback), distinguished
 *  by a `dragging` ref so a completed drag never also fires a click. */
export default function ComplaintWorkflowModal({
  complaintId,
  onClose,
  canManage,
}: {
  complaintId: number | null;
  onClose: () => void;
  canManage: boolean;
}) {
  const toast = useToast();
  const sheet = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<HTMLDivElement | null>(null);

  const [templates, setTemplates] = useState<StepTemplate[]>([]);
  const [tasks, setTasks] = useState<StepTask[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragTemplate, setDragTemplate] = useState<StepTemplate | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<number | "root" | null>(null);
  const [picker, setPicker] = useState<StepTemplate | null>(null); // click/keyboard fallback

  const pending = useRef<{ template: StepTemplate; x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const hoverRef = useRef<number | "root" | null>(null);

  const load = useCallback(async () => {
    if (complaintId === null) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/sales/complaints/${complaintId}/steps`);
      const json = await res.json();
      if (res.ok) {
        setTemplates(json.templates ?? []);
        setTasks(json.tasks ?? []);
        setEdges(json.edges ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [complaintId]);

  useEffect(() => {
    if (complaintId !== null) load();
  }, [complaintId, load]);

  useEffect(() => {
    if (complaintId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    sheet.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [complaintId, onClose]);

  async function spawn(templateKey: string, fromTaskId: number | null) {
    if (complaintId === null) return;
    try {
      const res = await fetch(`/api/sales/complaints/${complaintId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_key: templateKey, from_task_id: fromTaskId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "افزودن مرحله انجام نشد", "error");
        return;
      }
      toast("مرحله اضافه شد", "success");
      load();
    } catch {
      toast("افزودن مرحله انجام نشد", "error");
    }
  }

  async function completeStep(taskId: number) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast("ثبت انجام‌شدن مرحله ناموفق بود", "error");
    }
  }

  const endDrag = useCallback(() => {
    pending.current = null;
    dragging.current = false;
    hoverRef.current = null;
    setDragTemplate(null);
    setPointer(null);
    setHoverTarget(null);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pending.current;
      if (!p) return;
      if (!dragging.current) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (moved < 6) return;
        dragging.current = true;
        setDragTemplate(p.template);
        document.body.style.userSelect = "none";
      }
      setPointer({ x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const node = el?.closest<HTMLElement>("[data-step-target]");
      const id = node ? (node.dataset.stepTarget === "root" ? "root" : Number(node.dataset.stepTarget)) : null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        setHoverTarget(id);
      }
    }
    function onUp() {
      if (dragging.current && pending.current) {
        const target = hoverRef.current;
        const template = pending.current.template;
        if (target !== null) {
          spawn(template.key, target === "root" ? null : target);
        }
      }
      document.body.style.userSelect = "";
      endDrag();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endDrag, complaintId]);

  function onTemplatePointerDown(e: React.PointerEvent, t: StepTemplate) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pending.current = { template: t, x: e.clientX, y: e.clientY };
  }

  const positions = layoutTree(
    tasks.map((t) => t.id),
    edges,
  );
  const posById = new Map(positions.map((p) => [p.id, p]));

  return (
    <>
      <div className={`kargah-scrim${complaintId !== null ? " on" : ""}`} onClick={onClose} aria-hidden />
      <div
        className={`modal${complaintId !== null ? " on" : ""} workflow-modal`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-title"
        aria-hidden={complaintId === null}
        tabIndex={-1}
        ref={sheet}
      >
        {complaintId !== null && (
          <>
            <div className="mhead">
              <div>
                <h2 id="wf-title">مسیر رسیدگی</h2>
                <div className="s">{loading ? "در حال بارگذاری…" : `${tasks.length} مرحله`}</div>
              </div>
              <button className="x" type="button" aria-label="بستن" onClick={onClose}>
                ×
              </button>
            </div>
            <div className="mbody">
              {canManage && (
                <div className="wf-palette" aria-label="مراحل قابل افزودن">
                  {templates.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="wf-template"
                      onPointerDown={(e) => onTemplatePointerDown(e, t)}
                      onClick={() => {
                        if (!dragging.current) setPicker(t);
                      }}
                    >
                      {t.label_fa}
                    </button>
                  ))}
                </div>
              )}

              <div className="wf-graph" ref={graphRef}>
                <svg className="wf-edges" aria-hidden="true">
                  {edges.map((e) => {
                    const from = posById.get(e.from_task_id);
                    const to = posById.get(e.to_task_id);
                    const toTask = tasks.find((t) => t.id === e.to_task_id);
                    if (!from || !to) return null;
                    const d = bezierPath(
                      { x: from.col * COL_W + NODE_W / 2, y: from.row * ROW_H + NODE_H },
                      { x: to.col * COL_W + NODE_W / 2, y: to.row * ROW_H },
                    );
                    return (
                      <path
                        key={`${e.from_task_id}-${e.to_task_id}`}
                        d={d}
                        className={toTask?.status === "done" ? "wf-edge wf-edge--resolved" : "wf-edge wf-edge--pending"}
                      />
                    );
                  })}
                </svg>

                <div
                  className={`wf-root${hoverTarget === "root" ? " wf-drop-hover" : ""}`}
                  data-step-target="root"
                >
                  شکایت
                </div>

                {tasks.map((t) => {
                  const pos = posById.get(t.id);
                  if (!pos) return null;
                  return (
                    <div
                      key={t.id}
                      data-step-target={t.id}
                      className={`wf-node${t.status === "done" ? " wf-node--done" : ""}${
                        hoverTarget === t.id ? " wf-drop-hover" : ""
                      }`}
                      style={{ top: pos.row * ROW_H, insetInlineStart: pos.col * COL_W }}
                    >
                      <span>{t.title}</span>
                      {canManage && t.status !== "done" && (
                        <button type="button" className="wf-complete" onClick={() => completeStep(t.id)}>
                          تکمیل
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Drag ghost -- pointer-events:none so it never occludes the drop target under it. */}
      {dragTemplate && pointer && (
        <div className="wf-ghost" style={{ left: pointer.x, top: pointer.y }} aria-hidden>
          {dragTemplate.label_fa}
        </div>
      )}

      {/* Keyboard/tap fallback: pick a target instead of dragging. */}
      {picker && (
        <div className="kargah-scrim on" onClick={() => setPicker(null)} aria-hidden />
      )}
      {picker && (
        <div className="modal on wf-picker" role="dialog" aria-modal="true">
          <div className="mhead">
            <h2>افزودن «{picker.label_fa}» به کجا؟</h2>
            <button className="x" type="button" aria-label="بستن" onClick={() => setPicker(null)}>
              ×
            </button>
          </div>
          <div className="mbody">
            <button
              type="button"
              className="wf-pick-option"
              onClick={() => {
                spawn(picker.key, null);
                setPicker(null);
              }}
            >
              مستقیم به شکایت
            </button>
            {tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className="wf-pick-option"
                onClick={() => {
                  spawn(picker.key, t.id);
                  setPicker(null);
                }}
              >
                بعد از «{t.title}»
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build. (Not wired into any page yet — this only checks the component
compiles on its own.)

- [ ] **Step 3: Commit**

```bash
git add components/sales/ComplaintWorkflowModal.tsx
git commit -m "feat: ComplaintWorkflowModal -- the drag-to-link resolution graph"
```

---

### Task 4: Wire the modal into `ComplaintsPanel`

**Files:**
- Modify: `components/sales/ComplaintsPanel.tsx`

**Interfaces:**
- Consumes: `ComplaintWorkflowModal` (Task 3).

- [ ] **Step 1: Add the trigger and modal**

In `components/sales/ComplaintsPanel.tsx`, add state for which complaint's modal is
open, a new table header cell, and a "مسیر رسیدگی" button per row (visible to everyone
who can see the table; the modal itself gates spawning on `canManage`, matching every
other write in this panel):

```tsx
import { useState } from "react"; // already imported -- extend, don't duplicate
import ComplaintWorkflowModal from "./ComplaintWorkflowModal";
```

```tsx
  const [workflowFor, setWorkflowFor] = useState<number | null>(null);
```

In the table header row, add one more `<th>` before the `canManage` one:

```tsx
              <th className="p-2" />
```

In each row, add a cell with the trigger button (placed before the existing
`canManage && (...)` status-change cell):

```tsx
                <td className="p-2 text-left">
                  <button
                    type="button"
                    onClick={() => setWorkflowFor(c.id)}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent"
                  >
                    مسیر رسیدگی
                  </button>
                </td>
```

At the end of the component's returned JSX (as a sibling of the outer wrapping `<div>`,
so it is not nested inside the table), render the modal:

```tsx
      <ComplaintWorkflowModal
        complaintId={workflowFor}
        onClose={() => setWorkflowFor(null)}
        canManage={canManage}
      />
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add components/sales/ComplaintsPanel.tsx
git commit -m "feat: wire ComplaintWorkflowModal into ComplaintsPanel"
```

---

### Task 5: CSS — graph, nodes, connectors, palette

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add the workflow-modal styles**

Append after the existing `.modal`/`.mhead`/`.mbody` block (find it with
`grep -n "^\.modal {" app/globals.css` and insert after that whole block's closing
rules):

```css
/* ---- complaint resolution workflow graph ----------------------------------
   Spec 2026-09-08 §9c: curved bezier edges, solid=resolved/dashed=pending. Drag
   mechanic is AssignmentBoard.tsx's pattern; this is purely the graph's own paint. */
.workflow-modal { max-width: 640px; }
.wf-palette {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;
  padding-bottom: 16px; border-bottom: 1px solid var(--line);
}
.wf-template {
  border-radius: var(--radius-pill); border: 1px solid var(--border);
  background: var(--surface); padding: 8px 14px; font-size: 13px; color: var(--ink-2);
  cursor: grab; touch-action: none;
}
.wf-template:hover { border-color: var(--accent); color: var(--ink); }
.wf-graph { position: relative; min-height: 160px; padding: 8px 4px 24px; overflow: auto; }
.wf-edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.wf-edge { fill: none; stroke: var(--line-2); stroke-width: 2; }
.wf-edge--resolved { stroke: var(--sage); }
.wf-edge--pending { stroke-dasharray: 5 5; }
.wf-root, .wf-node {
  position: absolute; width: 150px; min-height: 44px; border-radius: var(--r-lg);
  border: 1px solid var(--border); background: var(--surface); box-shadow: var(--sh-1);
  padding: 8px 10px; font-size: 12.5px; color: var(--ink);
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
}
.wf-root { position: static; margin-bottom: 24px; width: fit-content; background: var(--sunk); font-weight: 600; }
.wf-node--done { opacity: 0.7; text-decoration: line-through; }
.wf-drop-hover { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft, var(--accent)); }
.wf-complete {
  border: 0; background: transparent; color: var(--accent-text); font-size: 11px;
  cursor: pointer; flex: none;
}
.wf-ghost {
  position: fixed; z-index: 60; transform: translate(-50%, -50%);
  pointer-events: none; border-radius: var(--radius-pill); background: var(--primary);
  color: var(--primary-ink); padding: 8px 14px; font-size: 13px; box-shadow: var(--sh-3);
}
.wf-picker { max-width: 360px; }
.wf-pick-option {
  display: block; width: 100%; text-align: start; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface);
  margin-bottom: 6px; font-size: 13px; color: var(--ink-2); cursor: pointer;
}
.wf-pick-option:hover { border-color: var(--accent); color: var(--ink); }
@media (prefers-reduced-motion: no-preference) {
  .wf-node, .wf-root { transition: box-shadow 160ms var(--ease); }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: CSS for the complaint workflow graph (nodes, connectors, palette)"
```

---

### Task 6: MASTER.md update

**Files:**
- Modify: `MASTER.md`

- [ ] **Step 1: Close out the deferred bullet**

Update the "The workflow-editor UI..." deferred bullet (added by PR#4) to say it is
done, and update "Complaint resolution workflow `SHIPPED` (backend only)"'s heading to
drop "(backend only)" now that the UI exists too — fold the UI's shape (drag mechanic
reused from `AssignmentBoard.tsx`, pure `layoutTree`/`bezierPath` modules, modal reuses
`.kargah-scrim`/`.modal`) into that section.

- [ ] **Step 2: Commit**

```bash
git add MASTER.md
git commit -m "docs: MASTER.md -- complaint resolution workflow UI shipped"
```

---

### Task 7: Full verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Contrast check**

Run: `node scripts/check-contrast.mjs`
Expected: passes. This task's CSS introduces new token *uses* (`--sage`, `--line-2`,
`--sunk`, `--accent-text`) but no new literal colors, so no new pairs to check beyond
what already exists — confirm the script still reports the same pair count as before
this branch, meaning nothing new needed checking that wasn't already covered.

- [ ] **Step 3: Full build, grep the WHOLE output**

Run: `npm run build 2>&1 | grep -iE "warn|error"`
Expected: no output.

- [ ] **Step 4: Real-browser smoke check**

Mirror the shell plan's Task 10 discipline — verify against the actual built page with
a real Playwright script (mint a session cookie the same way, see that plan for the
exact pattern), not by reasoning about the component:

1. Start the built app on a scratch port (not 3000/3003).
2. Log in as an owner, navigate to `/sales/complaints`, file one complaint via the
   existing form.
3. Click its "مسیر رسیدگی" button, confirm the modal opens (`.modal.on` visible).
4. Click (not drag — headless click is the reliable check) a template button, confirm
   the picker opens, click "مستقیم به شکایت", confirm a node appears in the graph.
5. Click a second template, pick "بعد از «...»" targeting the first node, confirm a
   second node and a connecting `<path>` appear.
6. Click "تکمیل" on the first node, reload the modal's data, confirm the edge into the
   second node switches from `.wf-edge--pending` to `.wf-edge--resolved`.
7. Stop the scratch server.

If any step fails, fix it in the relevant task's file and re-run before moving on.

- [ ] **Step 5: Restore the shared working directory's production build**

```bash
git status --porcelain -uall   # MUST be completely empty before switching
git checkout main
npm run build
systemctl restart routeflow
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3003/login   # expect 200
git checkout <this branch>
git status --porcelain -uall   # confirm still clean after switching back
```
