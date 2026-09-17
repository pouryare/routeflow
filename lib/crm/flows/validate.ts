import { answerStep, startFlow, viewStep } from "./machine";
import type { FlowConfig, FlowContext, FlowState } from "./types";

/** One context to walk the flow under, plus the value each input/custom step receives. */
export interface FlowVariant { ctx: FlowContext; values: Record<string, string> }
export interface FlowReport { deadEnds: string[]; shortest: number; longest: number }

/** Every answer sequence, depth-first. A step already on the current path is not
 *  re-entered (a "put me through" loop's exits are explored from its first visit), and the
 *  skip escape is not counted -- it is checked by asserting the skip step saves. */
export function checkFlow(cfg: FlowConfig, variants: FlowVariant[]): FlowReport {
  const deadEnds = new Set<string>();
  let shortest = Infinity;
  let longest = 0;
  for (const v of variants) {
    const walk = (st: FlowState, depth: number, seen: string[]) => {
      if (depth > 20) {
        deadEnds.add(`too deep: ${seen.join(">")}`);
        return;
      }
      const view = viewStep(cfg, v.ctx, st);
      if (view.options.length === 0) {
        deadEnds.add(`no options at ${view.id}`);
        return;
      }
      for (const o of view.options) {
        let next: FlowState;
        try {
          next = answerStep(cfg, v.ctx, st, o.id, v.values[view.id]);
        } catch (e) {
          deadEnds.add(`${view.id}.${o.id}: ${(e as Error).message}`);
          continue;
        }
        if (next.saved) {
          shortest = Math.min(shortest, depth + 1);
          longest = Math.max(longest, depth + 1);
          continue;
        }
        const to = next.stack[next.stack.length - 1];
        if (seen.includes(to)) continue;
        walk(next, depth + 1, [...seen, to]);
      }
    };
    const st0 = startFlow(cfg, v.ctx);
    walk(st0, 0, [st0.stack[0]]);
  }
  return { deadEnds: [...deadEnds], shortest, longest };
}
