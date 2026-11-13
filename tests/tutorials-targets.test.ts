import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TUTORIALS } from "@/lib/tutorials/catalog";
import type { FlowConfig } from "@/lib/crm/flows/types";
import { complaintFlow } from "@/lib/flows/complaint";
import { deliveryFlow } from "@/lib/flows/delivery";
import { expenseFlow } from "@/lib/flows/expense";
import { lifecycleFlow } from "@/lib/flows/lifecycle";
import { orderActionFlow } from "@/lib/flows/orderAction";
import { orderQuickFlow } from "@/lib/flows/orderQuick";
import { outcomeFlow } from "@/lib/flows/outcome";
import { paymentFlow } from "@/lib/flows/payment";
import { placeFlow } from "@/lib/flows/place";
import { receiveFlow } from "@/lib/flows/receive";
import { reminderFlow } from "@/lib/flows/reminder";
import { stockCountFlow } from "@/lib/flows/stockCount";
import { visitPlanFlow } from "@/lib/flows/visitPlan";
import { userAddFlow } from "@/lib/flows/userAdd";
import { addLeadFlow } from "@/lib/crm/flows/addLead";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import { QUICK_ACTIONS } from "@/lib/mobileNav";
import { appTabs } from "@/lib/appNav";
import { driverLinks } from "@/lib/driverLinks";
import { ROLES } from "@/lib/roles";

/** Every step that points at a button must point at one that exists, or the tutorial waits for a
 *  target that never comes. Targets are written three ways: a literal `data-tour="x"` (or a
 *  `tour="x"` prop), a tap-flow answer `flow:step:answer` (TapFlow tags every answer that way) and
 *  a link whose id carries its address (`nav:`, `link:`, `quick:`). */
const FLOWS: FlowConfig[] = [
  complaintFlow, deliveryFlow, expenseFlow, lifecycleFlow, orderActionFlow, orderQuickFlow, outcomeFlow,
  paymentFlow, placeFlow, receiveFlow, reminderFlow, stockCountFlow, visitPlanFlow, userAddFlow(ROLES),
  addLeadFlow, afterCallFlow, driverVisitFlow, leadVisitFlow,
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith(".tsx")) out.push(readFileSync(p, "utf8"));
  }
  return out;
}
const CODE = [...sources("app"), ...sources("components")].join("\n");
const LITERAL = new Set([...CODE.matchAll(/(?:data-tour|tour)="([^"]+)"/g)].map((m) => m[1]));

const hrefs = new Set([
  ...ROLES.flatMap((role) => appTabs({ role }).map((t) => t.href)),
  ...ROLES.flatMap((role) => driverLinks({ role }).map((l) => l.href)),
]);

function exists(target: string): boolean {
  if (LITERAL.has(target)) return true;
  if (target === "nav:more") return true;
  if (target.startsWith("nav:") || target.startsWith("link:")) return hrefs.has(target.slice(target.indexOf(":") + 1));
  if (target.startsWith("quick:")) return QUICK_ACTIONS.some((a) => a.id === target.slice(6));
  const [flowId, stepId, optionId] = target.split(":");
  const flow = FLOWS.find((f) => f.id === flowId);
  const step = flow?.steps[stepId];
  if (!step) return false;
  // TapFlow tags a whole step only for the kinds that draw their own body.
  if (optionId === undefined) return ["amount", "pick", "stepper"].includes(step.kind);
  // Options that depend on the record (a function) cannot be listed here; the step is enough.
  return typeof step.options === "function" || step.options.some((o) => o.id === optionId);
}

describe("tutorial targets", () => {
  it("every step points at a button that exists", () => {
    const missing = TUTORIALS.flatMap((t) => t.steps.filter((s) => s.target && !exists(s.target)).map((s) => `${t.id}: ${s.target}`));
    expect(missing).toEqual([]);
  });
  it("a whole step that needs typing moves on with «ادامه», not a tap", () => {
    for (const t of TUTORIALS)
      for (const s of t.steps) {
        if (!s.target) continue;
        const [flowId, stepId, optionId] = s.target.split(":");
        const step = FLOWS.find((f) => f.id === flowId)?.steps[stepId];
        if (!step || optionId !== undefined) continue;
        if (step.kind !== "pick") expect(s.advance, `${t.id}: ${s.target}`).toBe("next");
      }
  });
  // The gap check (CLAUDE.md «a new main action gets a tutorial»): every `open:<flow>` button on a
  // screen has a tutorial that points at it or at a step of its flow. A gap needs a written reason.
  const NO_TUTORIAL_YET: Record<string, string> = {
    "open:place": "shortcut: no tutorial for setting a customer's place yet; written before 0.1 (see TODO-REPORT.md)",
    "open:transfer": "shortcut: no tutorial for moving money between own accounts yet; owner-only screen, listed in TODO-REPORT.md",
  };
  it("every main «open:» button has a tutorial or a written reason", () => {
    const opens = new Set<string>();
    for (const m of CODE.matchAll(/data-tour="(open:[a-z_]+)"/g)) opens.add(m[1]);
    const targets = TUTORIALS.flatMap((t) => t.steps.map((s) => s.target ?? ""));
    const gaps = [...opens].filter((o) => !NO_TUTORIAL_YET[o] && !targets.some((t) => t === o || t.startsWith(`${o.slice(5)}:`)));
    expect(gaps).toEqual([]);
  });
});
