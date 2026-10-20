import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TapFlow from "@/components/tapflow/TapFlow";
import { EMPTY_CONTEXT, type FlowConfig, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow } from "@/lib/crm/flows/machine";

const ok = [{ id: "ok", label: "ثبت", tone: "rec" as const, save: true }];
const cfgFor = (kind: "amount" | "pick" | "stepper"): FlowConfig => ({
  id: "t", start: () => "s", budget: { common: 1, longest: 1 },
  steps: {
    s: {
      id: "s", kind, q: "سؤال؟", options: ok,
      input: kind === "amount" ? { field: "amt", placeholder: "مبلغ به تومان", ltr: true } : undefined,
      choices: kind === "pick" ? [{ id: "5", label: "بقالی رضا" }, { id: "6", label: "نانوایی سنگک" }] : undefined,
    },
  },
});
const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  vars: { amt: "800000" },
  items: [{ id: 11, label: "شیر", qty: 10 }, { id: 12, label: "ماست", qty: 6 }],
};
const html = (kind: "amount" | "pick" | "stepper") => {
  const cfg = cfgFor(kind);
  return renderToStaticMarkup(createElement(TapFlow, {
    open: true, title: "t", config: cfg, ctx, state: startFlow(cfg, ctx),
    onState: () => {}, onSaved: () => {}, onClose: () => {},
  }));
};

describe("generic step bodies render inside TapFlow", () => {
  it("amount: prefilled from ctx.vars, one confirm button, no duplicate text input", () => {
    const h = html("amount");
    expect(h).toContain('value="800000"');
    expect(h).toContain("ثبت");
    expect(h.match(/<input/g)).toHaveLength(1);
  });
  it("pick: lists the choices and offers a search box", () => {
    const h = html("pick");
    expect(h).toContain("بقالی رضا");
    expect(h).toContain("نانوایی سنگک");
    expect(h.match(/<input/g)).toHaveLength(1);
  });
  it("stepper: one row per item, each prefilled with what was expected", () => {
    const h = html("stepper");
    expect(h).toContain("شیر");
    expect(h).toContain("ماست");
    expect(h).toContain("۱۰");
    expect(h).toContain("۶");
    expect(h).toContain("کم کردن شیر");
  });
});
