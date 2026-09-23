import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowConfig, type FlowContext } from "@/lib/crm/flows/types";
import { checkFlow, type FlowVariant } from "@/lib/crm/flows/validate";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { addLeadFlow, pinOf, basicsOf, hasPhone } from "@/lib/crm/flows/addLead";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";
import type { ResolvedOption } from "@/lib/crm/flows/types";

const PIN = JSON.stringify({ lat: 35.76, lng: 51.41, precision: "exact" });
const base: FlowContext = {
  ...EMPTY_CONTEXT,
  vars: { name: "کبابی نمونه", source: "گوگل مپ", contact: "علی · مسئول خرید", address: "ونک" },
  knownContacts: [{ id: 7, name: "علی", role: "PURCHASING" }],
  products: [{ id: 1, name: "کره ۱۰ گرمی", price_toman: 1000 }, { id: 2, name: "پودر کاکائو", price_toman: null }],
  reps: [{ id: 11, name: "فاطمه", open: 30 }, { id: 12, name: "نازنین", open: 8 }],
  recentCustomers: [{ id: 3, name: "رستوران نایب" }],
};
const callValues = { newnum: "09120001234", rename: "کافه نو", movedpin: PIN, who: "رضا", prods: "1,2" };

function assertBudget(cfg: FlowConfig, variants: FlowVariant[]) {
  const r = checkFlow(cfg, variants);
  expect(r.deadEnds).toEqual([]);
  expect(r.shortest).toBeLessThanOrEqual(cfg.budget.common);
  expect(r.longest).toBeLessThanOrEqual(cfg.budget.longest);
  const skip = cfg.skipStep ? cfg.steps[cfg.skipStep] : null;
  if (skip && Array.isArray(skip.options)) for (const o of skip.options) expect(o.save).toBe(true);
}

describe("after-call flow", () => {
  it("has no dead ends and stays inside its budget in every context", () => {
    assertBudget(afterCallFlow, [
      { ctx: { ...base, firstContact: true, knownContacts: [] }, values: callValues },
      { ctx: { ...base, firstContact: false }, values: callValues },
      { ctx: { ...base, firstContact: true, attemptNo: 5 }, values: callValues },
      { ctx: { ...base, entry: "talked_now" }, values: callValues },
    ]);
  });
  it("asks a first call to verify the lead before anything else", () => {
    const ctx = { ...base, firstContact: true };
    const st = answerStep(afterCallFlow, ctx, startFlow(afterCallFlow, ctx), "talked");
    expect(st.stack.at(-1)).toBe("verify");
  });
  it("offers known contacts first, then roles grouped by decider/staff", () => {
    const ctx = { ...base, entry: "talked_now" as const };
    const v = viewStep(afterCallFlow, ctx, startFlow(afterCallFlow, ctx));
    expect(v.options[0]).toMatchObject({ id: "c7", label: "علی" });
    expect(new Set(v.options.slice(1).map((o: ResolvedOption) => o.group ?? ""))).toEqual(new Set(["تصمیم‌گیرنده", "کارکنان"]));
  });
  it("a missed call can be saved in two taps", () => {
    let st = startFlow(afterCallFlow, base);
    st = answerStep(afterCallFlow, base, st, "no_answer");
    st = answerStep(afterCallFlow, base, st, "t10");
    expect(st.saved).toBe(true);
    expect(st.acc).toMatchObject({ outcome: "NO_ANSWER", next_kind: "call" });
  });
});

describe("add-lead flow", () => {
  const withPhone = { link: JSON.stringify({ name: "کافه نو", lat: 35.7, lng: 51.4, address: "ونک", maps_url: "https://maps.app.goo.gl/x" }),
    basics: JSON.stringify({ name: "کافه نو", phone: "09120001234", branch_of: null }), pin: PIN, here: PIN, hours: "[]", refname: "علی", other: "نمایشگاه" };
  const noPhoneNoPin = { ...withPhone, link: JSON.stringify({ name: null, lat: null, lng: null, address: null, maps_url: "https://x" }),
    basics: JSON.stringify({ name: "کافه نو", phone: "", branch_of: null }), here: "" };
  it("has no dead ends and stays inside its budget", () => {
    assertBudget(addLeadFlow, [
      { ctx: { ...base, entry: "add_lead" }, values: withPhone },
      { ctx: { ...base, entry: "add_lead", isManager: true }, values: withPhone },
      { ctx: { ...base, entry: "add_lead" }, values: noPhoneNoPin },
    ]);
  });
  it("sends a phone-less lead to a verification visit, never a call", () => {
    const ctx = { ...base, entry: "add_lead" as const };
    let st = startFlow(addLeadFlow, ctx);
    st = answerStep(addLeadFlow, ctx, st, "SNAPPFOOD");
    st = answerStep(addLeadFlow, ctx, st, "nolink", noPhoneNoPin.link);
    st = answerStep(addLeadFlow, ctx, st, "ok", noPhoneNoPin.basics);
    expect(st.stack.at(-1)).toBe("loc");
    st = answerStep(addLeadFlow, ctx, st, "map");
    st = answerStep(addLeadFlow, ctx, st, "ok", JSON.stringify({ lat: 35.7, lng: 51.4, precision: "approx" }));
    st = answerStep(addLeadFlow, ctx, st, "CAFE");
    st = answerStep(addLeadFlow, ctx, st, "mid");
    st = answerStep(addLeadFlow, ctx, st, "skip");
    const first = viewStep(addLeadFlow, ctx, st);
    expect(first.options.map((o: ResolvedOption) => o.id)).toEqual(["driver", "self", "talked"]);
  });
  it("reads values: the explicit pin beats the link's", () => {
    expect(pinOf({ link: withPhone.link, pin: JSON.stringify({ lat: 35.8, lng: 51.5, precision: "approx" }) })).toMatchObject({ lat: 35.8, precision: "approx" });
    expect(pinOf({ link: noPhoneNoPin.link })).toBeNull();
    expect(pinOf({ pin: JSON.stringify({ lat: 0, lng: 0, precision: "exact" }) })).toBeNull();
    expect(basicsOf(withPhone)?.name).toBe("کافه نو");
    expect(hasPhone(withPhone)).toBe(true);
    expect(hasPhone(noPhoneNoPin)).toBe(false);
  });
});

describe("driver visit flow", () => {
  it("is five taps on the common path and has no dead ends", () => {
    assertBudget(driverVisitFlow, [{ ctx: { ...base, entry: "driver_visit" }, values: { phone: "09120001234", who: "" } }]);
  });
});
