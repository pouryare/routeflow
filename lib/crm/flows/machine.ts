import { CONTACT_ROLE_LABEL, faDigits } from "../vocab";
import type { FlowAnswer, FlowConfig, FlowContext, FlowOption, FlowSet, FlowState, FlowStep, ResolvedStep } from "./types";

export class FlowError extends Error {}
/** The option id a time step's «بدون کار بعدی…» sends. */
export const SKIP = "__skip";

function stepOf(cfg: FlowConfig, id: string): FlowStep {
  const s = cfg.steps[id];
  if (!s) throw new FlowError(`unknown step ${id}`);
  return s;
}
const dyn = <T>(v: T | ((c: FlowContext, s: { acc: FlowSet; values: Record<string, string> }) => T), ctx: FlowContext, st: FlowState): T =>
  typeof v === "function" ? (v as (c: FlowContext, s: { acc: FlowSet; values: Record<string, string> }) => T)(ctx, { acc: st.acc, values: st.values }) : v;
const optionsOf = (step: FlowStep, ctx: FlowContext, st: FlowState): FlowOption[] => dyn(step.options, ctx, st);

export function interpolate(text: string, ctx: FlowContext, acc: FlowSet): string {
  const vars: Record<string, string> = {
    ...ctx.vars,
    attempt: faDigits(String(ctx.attemptNo)),
    max: faDigits(String(ctx.maxMisses)),
    decider: acc.decider_role ? CONTACT_ROLE_LABEL[acc.decider_role] : "",
    role: acc.contact_role ? CONTACT_ROLE_LABEL[acc.contact_role] : "",
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function startFlow(cfg: FlowConfig, ctx: FlowContext): FlowState {
  const first = cfg.start(ctx);
  stepOf(cfg, first);
  return { stack: [first], answers: [], acc: {}, values: {}, saved: false };
}

export function viewStep(cfg: FlowConfig, ctx: FlowContext, st: FlowState): ResolvedStep {
  const step = stepOf(cfg, st.stack[st.stack.length - 1]);
  const sub = step.sub === undefined ? undefined : dyn(step.sub, ctx, st);
  return {
    id: step.id,
    kind: step.kind,
    q: interpolate(step.q, ctx, st.acc),
    sub: sub ? interpolate(sub, ctx, st.acc) : undefined,
    options: optionsOf(step, ctx, st).map((o) => ({
      id: o.id,
      label: interpolate(o.label, ctx, st.acc),
      sub: o.sub ? interpolate(o.sub, ctx, st.acc) : undefined,
      tone: o.tone,
      group: o.group,
      due: o.set?.due,
      saves: o.save === true,
    })),
    choices: step.choices ? dyn(step.choices, ctx, st) : [],
    input: step.input,
    timeStep: !!step.timeStep && !!cfg.skipStep,
  };
}

export function answerStep(cfg: FlowConfig, ctx: FlowContext, st: FlowState, optionId: string, value?: string): FlowState {
  if (st.saved) throw new FlowError("flow already saved");
  const stepId = st.stack[st.stack.length - 1];
  const step = stepOf(cfg, stepId);

  if (optionId === SKIP) {
    if (!step.timeStep || !cfg.skipStep) throw new FlowError(`no skip at ${stepId}`);
    return { ...st, stack: [...st.stack, cfg.skipStep], answers: [...st.answers, { step: stepId, option: SKIP }] };
  }

  const opt = optionsOf(step, ctx, st).find((o) => o.id === optionId);
  if (!opt) throw new FlowError(`unknown option ${optionId} at ${stepId}`);

  const key = step.input?.field ?? stepId;
  const values = { ...st.values };
  const has = value !== undefined && value !== "";
  if (has) values[key] = value as string;
  else if (step.kind === "input" && step.input && !step.input.optional) throw new FlowError(`${key} is required`);

  const acc: FlowSet = { ...st.acc, ...(opt.set ?? {}) };
  // A `stars` step submits one comma-joined string ("potential,volume,ease"); decode it into
  // the structured `stars` set rather than leaving a raw string in `values`.
  if (step.kind === "stars" && has) {
    const [p, v, e] = String(value).split(",").map((n) => (n === "" ? null : Number(n)));
    acc.stars = { potential: p ?? null, volume: v ?? null, ease: e ?? null };
  }
  const answer: FlowAnswer = has ? { step: stepId, option: optionId, value } : { step: stepId, option: optionId };
  const answers = [...st.answers, answer];
  if (opt.save) return { stack: st.stack, answers, acc, values, saved: true };

  const nextId = typeof opt.next === "function" ? opt.next(ctx, { acc, values }) : opt.next;
  if (!nextId) throw new FlowError(`option ${optionId} at ${stepId} neither saves nor continues`);
  stepOf(cfg, nextId);
  return { stack: [...st.stack, nextId], answers, acc, values, saved: false };
}

export function replayAnswers(cfg: FlowConfig, ctx: FlowContext, answers: FlowAnswer[]): FlowState {
  let st = startFlow(cfg, ctx);
  for (const a of answers) {
    const cur = st.stack[st.stack.length - 1];
    if (a.step !== cur) throw new FlowError(`answer for ${a.step} but the flow is at ${cur}`);
    st = answerStep(cfg, ctx, st, a.option, a.value);
  }
  return st;
}

/** Up one step, keeping every earlier answer -- also how undo reopens the last question. */
export function backStep(cfg: FlowConfig, ctx: FlowContext, st: FlowState): FlowState {
  if (st.answers.length === 0) return st;
  return replayAnswers(cfg, ctx, st.answers.slice(0, -1));
}
