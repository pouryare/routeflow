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
