"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { useSwipeDismiss } from "@/components/useSwipeDismiss";
import { answerStep, backStep, SKIP, viewStep } from "@/lib/crm/flows/machine";
import type { FlowConfig, FlowContext, FlowState, ResolvedOption, ResolvedStep } from "@/lib/crm/flows/types";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { nextOpenAt, type WorkingHours } from "@/lib/crm/hours";
import { useChoiceFeedback } from "./useChoiceFeedback";

export interface CustomStepApi { step: ResolvedStep; state: FlowState; submit: (optionId: string, value?: string) => void }

export interface TapFlowProps {
  open: boolean;
  title: string;
  subtitle?: string;
  config: FlowConfig;
  ctx: FlowContext;
  state: FlowState;
  onState: (s: FlowState) => void;
  onSaved: (s: FlowState) => void;
  onClose: () => void;
  /** Renders the basics / link / pin / hours steps; each calls submit(optionId, value). */
  renderCustom?: (api: CustomStepApi) => ReactNode;
  /** Shown in place of the question once the flow has saved. */
  done?: ReactNode;
  /** Known working hours: time answers show the moved time when it changes. */
  hours?: WorkingHours;
}

const CUSTOM = new Set(["basics", "link", "pin", "hours", "stars"]);

/** One question per screen, in the meridian bottom sheet (docs/tap-flow-principles.md).
 *  Controlled: the host owns FlowState, which is what lets undo reopen the last question. */
export default function TapFlow(p: TapFlowProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const { open, onClose } = p;
  useSwipeDismiss(sheet, "down", onClose, open);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  const view = p.state.saved ? null : viewStep(p.config, p.ctx, p.state);
  const submit = (optionId: string, value?: string) => {
    const next = answerStep(p.config, p.ctx, p.state, optionId, value);
    p.onState(next);
    if (next.saved) p.onSaved(next);
  };

  return (
    <>
      <div className={`meridian-scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden />
      <div ref={sheet} className={`sheet${open ? " on" : ""}`} role="dialog" aria-modal="true" aria-labelledby="tf-title" aria-hidden={!open}>
        <div className="grab" />
        <div className="sheethead">
          <div>
            <h2 id="tf-title">{p.title}</h2>
            {p.subtitle ? <div className="s">{p.subtitle}</div> : null}
          </div>
          <button className="x" type="button" aria-label="بستن" onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className="tapflow" aria-live="polite">
          {p.state.saved
            ? p.done
            : view && (
                <>
                  <div className="tf-nav">
                    {p.state.answers.length > 0 ? (
                      <button type="button" className="tf-back" onClick={() => p.onState(backStep(p.config, p.ctx, p.state))}>‹ قبلی</button>
                    ) : <span />}
                    <div className="tf-steps" aria-hidden>
                      {Array.from({ length: 6 }, (_, i) => <i key={i} className={i < Math.min(p.state.stack.length, 6) ? "on" : ""} />)}
                    </div>
                  </div>
                  <p className="tf-q">{view.q}</p>
                  {view.sub ? <p className="tf-sub">{view.sub}</p> : null}
                  {CUSTOM.has(view.kind)
                    ? p.renderCustom?.({ step: view, state: p.state, submit })
                    : <StepBody key={`${view.id}-${p.state.answers.length}`} view={view} submit={submit} hours={p.hours} />}
                  {view.timeStep ? <button type="button" className="tf-skip" onClick={() => submit(SKIP)}>بدون کار بعدی…</button> : null}
                </>
              )}
        </div>
      </div>
    </>
  );
}

function StepBody({ view, submit, hours }: { view: ResolvedStep; submit: (id: string, value?: string) => void; hours?: WorkingHours }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const feedback = useChoiceFeedback();
  const now = new Date().toISOString();

  if (pickFor) {
    return (
      <div className="tf-grid one">
        <JalaliDateInput value={date} onChange={setDate} aria-label="روز" />
        <button type="button" className="tf-go" disabled={!date} onClick={() => submit(pickFor, date)}>همین روز</button>
        <button type="button" className="tf-skip" onClick={() => setPickFor(null)}>برگشت</button>
      </div>
    );
  }

  const needsText = view.kind === "input" && !!view.input && !view.input.optional && !text.trim();
  const subFor = (o: ResolvedOption): string | undefined => {
    if (!o.due || o.due.kind === "pick" || o.due.kind === "none" || !hours?.length) return o.sub;
    const raw = resolveDue(o.due, now);
    if (!raw) return o.sub;
    const moved = nextOpenAt(hours, raw);
    return moved === raw ? o.sub : `ساعت باز شدن: ${labelDue(moved, now)}`;
  };
  const tap = (o: ResolvedOption) => {
    if (o.due?.kind === "pick") { setPickFor(o.id); return; }
    const value = view.kind === "multi" ? picked.join(",") : view.input ? text.trim() : "";
    feedback.choose(o.id, (id) => submit(id, value || undefined));
  };
  const button = (o: ResolvedOption) => {
    const sub = subFor(o);
    const isSelected = feedback.selected === o.id;
    return (
      <button key={o.id} type="button" aria-pressed={isSelected}
        className={`tf-opt ${o.tone ?? ""}${isSelected ? " on" : ""}`} disabled={needsText || feedback.selected !== null} onClick={() => tap(o)}>
        {o.label}
        {sub ? <small>{sub}</small> : null}
        {isSelected ? <span className="tick" aria-hidden><Icon name="check" size="sm" /></span> : null}
      </button>
    );
  };

  const groups: { label: string | null; items: ResolvedOption[] }[] = [];
  for (const o of view.options) {
    const label = o.group ?? null;
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(o);
    else groups.push({ label, items: [o] });
  }

  return (
    <>
      {view.input ? (
        <input
          className={`tf-input${view.input.ltr ? " ltr" : ""}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={view.input.placeholder}
          inputMode={view.input.ltr ? "tel" : undefined}
          autoFocus={!view.input.optional}
          aria-label={view.input.placeholder}
        />
      ) : null}
      {view.kind === "multi" ? (
        <div className="tf-grid one">
          {view.choices.map((c) => (
            <button key={c.id} type="button" aria-pressed={picked.includes(c.id)} className={`tf-opt${picked.includes(c.id) ? " on" : ""}`}
              onClick={() => setPicked((xs) => (xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id]))}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.label ?? "_"} style={{ display: "grid", gap: 8 }}>
          {g.label ? <div className="tf-group">{g.label}</div> : null}
          <div className={`tf-grid${g.items.length > 8 ? " three" : g.items.length === 1 ? " one" : ""}`}>{g.items.map(button)}</div>
        </div>
      ))}
    </>
  );
}
