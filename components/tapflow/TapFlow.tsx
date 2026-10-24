"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { Icon } from "@/components/meridian/Icon";
import { PersianCalendar } from "@/components/PersianDateField";
import { answerStep, backStep, SKIP, viewStep } from "@/lib/crm/flows/machine";
import type { FlowConfig, FlowContext, FlowState, ResolvedOption, ResolvedStep } from "@/lib/crm/flows/types";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { nextOpenAt, type WorkingHours } from "@/lib/crm/hours";
import { useChoiceFeedback } from "./useChoiceFeedback";
import AmountStep from "./AmountStep";
import { AnswerButton, SkipButton } from "./Answer";
import PickStep from "./PickStep";
import StepperStep from "./StepperStep";
import type { FlowItem } from "@/lib/flows/item";

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
  /** Called when an option has a navigation URL — opens it instead of advancing. */
  onNavigate?: (url: string) => void;
  /** URL passed to onNavigate when the navigate step option is tapped. */
  navigateUrl?: string;
}

/** Steps the host renders itself via `renderCustom`, rather than TapFlow's own body.
 *  `driver` / `date` are the lead-run planner's picker steps. */
const CUSTOM = new Set(["basics", "link", "pin", "hours", "stars", "driver", "date", "photo"]);

/** One question per screen, in the shared BottomSheet (a HeroUI Drawer; docs/tap-flow-principles.md).
 *  Controlled: the host owns FlowState, which is what lets undo reopen the last question.
 *  Drag-down works from the handle or header only, never from the scrolling body (rule 9). */
export default function TapFlow(p: TapFlowProps) {
  const { open, onClose } = p;

  const view = p.state.saved ? null : viewStep(p.config, p.ctx, p.state);
  // A flow with a mis-set budget should still render one mark rather than none.
  const totalSteps = Math.max(1, p.config.budget?.longest ?? 1);
  const submit = (optionId: string, value?: string) => {
    const next = answerStep(p.config, p.ctx, p.state, optionId, value);
    p.onState(next);
    if (next.saved) p.onSaved(next);
  };
  const navigate = (url: string) => {
    p.onNavigate?.(url);
  };

  return (
    <BottomSheet open={open} title={p.title} subtitle={p.subtitle} onClose={onClose} closeLabel="بستن فرم" live>
      {p.state.saved
        ? p.done
        : view && (
            <>
              <div className="tf-nav">
                {p.state.answers.length > 0 ? (
                  <Button variant="tertiary" size="sm" className="flow-drawer__back" onPress={() => p.onState(backStep(p.config, p.ctx, p.state))}>
                    <Icon name="chevron-right" size="sm" /> سؤال قبلی
                  </Button>
                ) : <span />}
                <div className="tf-steps" aria-hidden>
                  {/* One mark per step this flow can actually reach, not a fixed six.
                      `budget.longest` is the declared maximum path length, and
                      crm-flow-configs.test.ts asserts it bounds the real one -- so the
                      count is honest for every flow instead of only the long ones. */}
                  {Array.from({ length: totalSteps }, (_, i) => (
                    <i key={i} className={i < p.state.stack.length ? "on" : ""} />
                  ))}
                </div>
              </div>
              <p className="tf-q">{view.q}</p>
              {view.sub ? <p className="tf-sub">{view.sub}</p> : null}
              {CUSTOM.has(view.kind)
                ? p.renderCustom?.({ step: view, state: p.state, submit })
                : <StepBody key={`${view.id}-${p.state.answers.length}`} view={view} submit={submit} hours={p.hours} onNavigate={navigate} navigateUrl={p.navigateUrl} vars={p.ctx.vars} items={p.ctx.items ?? []} />}
              {view && (view.skipable || view.timeStep) ? (
                  <Button variant="ghost" className="flow-drawer__skip" onPress={() => submit(SKIP)}>
                    <Icon name="arrow-left" size="md" />
                    {view.id === "navigate" ? "رد کردن" : "بدون کار بعدی…"}
                  </Button>
                ) : null}
            </>
          )}
    </BottomSheet>
  );
}

function StepBody({ view, submit, hours, onNavigate, navigateUrl, vars, items }: { view: ResolvedStep; submit: (id: string, value?: string) => void; hours?: WorkingHours; onNavigate?: (url: string) => void; navigateUrl?: string; vars: Record<string, string>; items: FlowItem[] }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const feedback = useChoiceFeedback();
  const now = new Date().toISOString();

  /* The generic kinds draw their own body, including the one option that moves on, so the
     option grid and the shared text input below must not also render for them. */
  if (view.kind === "amount") {
    const raw = view.input ? vars[view.input.field] : undefined;
    const unit = (view.input && vars[`${view.input.field}_unit`]) || view.input?.unit;
    return (
      <AmountStep
        prefill={raw ? Number(raw) : null}
        option={view.options[0]}
        label={view.input?.placeholder ?? "مبلغ"}
        unit={unit}
        decimal={view.input?.decimal}
        allowZero={view.input?.allowZero}
        submit={submit}
      />
    );
  }
  if (view.kind === "pick") return <PickStep choices={view.choices} optionId={view.options[0].id} extras={view.options.slice(1)} submit={submit} />;
  if (view.kind === "stepper") return <StepperStep items={items} option={view.options[0]} submit={submit} />;

  if (pickFor) {
    return (
      <div className="tf-grid one">
        <PersianCalendar value={date} onChange={setDate} ariaLabel="روز" />
        <Button variant="primary" size="lg" fullWidth isDisabled={!date} onPress={() => submit(pickFor, date)}>
          <Icon name="calendar" size="md" />
          همین روز
        </Button>
        <SkipButton icon="arrow-right" onPress={() => setPickFor(null)}>برگشت</SkipButton>
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
    if (view.id === "navigate" && onNavigate && navigateUrl) { onNavigate(navigateUrl); submit(o.id); return; }
    if (o.due?.kind === "pick") { setPickFor(o.id); return; }
    const value = view.kind === "multi" ? picked.join(",") : view.input ? text.trim() : "";
    feedback.choose(o.id, (id) => submit(id, value || undefined));
  };
  const button = (o: ResolvedOption) => {
    const sub = subFor(o);
    const isSelected = feedback.selected === o.id;
    return (
      <AnswerButton key={o.id} selected={isSelected} tone={o.tone} isDisabled={needsText || feedback.selected !== null} onPress={() => tap(o)}>
        {o.label}
        {sub ? <small>{sub}</small> : null}
        {isSelected ? <span className="tick" aria-hidden><Icon name="check" size="sm" /></span> : null}
      </AnswerButton>
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
            <AnswerButton key={c.id} icon="check" selected={picked.includes(c.id)}
              onPress={() => setPicked((xs) => (xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id]))}>
              {c.label}
            </AnswerButton>
          ))}
        </div>
      ) : null}
      {view.kind === "choice" ? (
        <div className="tf-grid one">
          {view.choices.map((c) => (
            <AnswerButton key={c.id} icon="check"
              onPress={() => { if (view.id === "navigate" && onNavigate && navigateUrl) { onNavigate(navigateUrl); } else { submit(c.id); } }}>
              {c.label}
            </AnswerButton>
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
