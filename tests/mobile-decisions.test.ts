import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DecisionDeck from "@/components/mobile/DecisionDeck";
import SwipeRow from "@/components/mobile/SwipeRow";
import { CHEQUE_CHOICES, COMPLAINT_CHOICES, chequeRequest, chequesDue, complaintRequest, complaintsToTriage } from "@/lib/decisions";
import { CHEQUE_TRANSITIONS } from "@/lib/chequeStates";

describe("decision queues", () => {
  it("cheques due: only those in hand, due by the horizon, oldest first", () => {
    const list = [
      { id: 1, status: "in_hand" as const, due_date: "2026-10-25" },
      { id: 2, status: "in_hand" as const, due_date: "2026-10-18" },
      { id: 3, status: "deposited" as const, due_date: "2026-10-19" },
      { id: 4, status: "in_hand" as const, due_date: "2026-12-01" },
    ];
    expect(chequesDue(list, "2026-10-27").map((c) => c.id)).toEqual([2, 1]);
  });
  it("every cheque verdict is a move the server allows from 'in hand'", () => {
    for (const c of CHEQUE_CHOICES) expect(CHEQUE_TRANSITIONS.in_hand).toContain(c.id);
    expect(chequeRequest("bounced")).toEqual({ action: "advance", to: "bounced" });
  });
  it("complaints: only open ones are triaged; verdicts are statuses", () => {
    expect(complaintsToTriage([{ status: "open" }, { status: "resolved" }])).toHaveLength(1);
    expect(COMPLAINT_CHOICES.map((c) => c.id)).toEqual(["investigating", "resolved", "dismissed"]);
    expect(complaintRequest("resolved")).toEqual({ status: "resolved" });
  });
});

describe("deck and swipe row render", () => {
  it("shows progress, the card, big verdict buttons and a way to skip", () => {
    const out = renderToStaticMarkup(
      h(DecisionDeck<{ id: number; n: string }>, {
        open: true, title: "چک‌ها", items: [{ id: 1, n: "الف" }, { id: 2, n: "ب" }], keyOf: (i) => i.id,
        render: (i) => h("strong", null, i.n), choices: CHEQUE_CHOICES, onDecide: () => {}, onClose: () => {},
      }),
    );
    expect(out).toContain("۱ از ۲");
    expect(out).toContain("الف");
    expect(out).toContain("برگشت خورد");
    expect(out).toContain("بعداً");
  });
  it("an empty deck says there is nothing to decide", () => {
    const out = renderToStaticMarkup(
      h(DecisionDeck<number>, { open: true, title: "t", items: [], keyOf: (i) => i, render: () => null, choices: [], onDecide: () => {}, onClose: () => {} }),
    );
    expect(out).toContain("موردی برای تصمیم‌گیری نیست");
  });
  it("a swipe row keeps its actions as real buttons unless the row has its own", () => {
    const act = { label: "حذف", icon: "trash" as const, run: () => {} };
    expect(renderToStaticMarkup(h(SwipeRow, { end: act, children: "x" }))).toContain("swiperow__btn");
    expect(renderToStaticMarkup(h(SwipeRow, { end: act, ownButtons: false, children: "x" }))).not.toContain("swiperow__btn");
  });
});
