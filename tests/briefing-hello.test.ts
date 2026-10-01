import { describe, it, expect } from "vitest";
import { needsAttention, mostUrgent, cardFor } from "@/lib/repo/briefingCards";
import type { BriefingPanel } from "@/lib/repo/briefing";

const item = (over: Partial<BriefingPanel["items"][0]> = {}) => ({
  label: "مورد",
  tone: "warn" as const,
  href: "/x",
  ...over,
});

const panel = (key: string, items: BriefingPanel["items"]): BriefingPanel => ({
  key,
  title: key,
  items,
});

describe("what needs the reader's attention", () => {
  it("counts only panels that DEMAND something", () => {
    const panels = [
      panel("a", [item({ tone: "crit" }), item({ tone: "warn" })]),
      panel("b", [item({ tone: "info" })]),
      panel("c", []),
    ];
    expect(needsAttention(panels)).toBe(2);
  });

  it("counts nothing when every panel is informational", () => {
    expect(needsAttention([panel("a", [item({ tone: "info" })])])).toBe(0);
  });

  it("is 0 for no panels at all, so the hero can render honestly", () => {
    expect(needsAttention([])).toBe(0);
  });

  it("picks the crit item first when several need attention", () => {
    const panels = [
      panel("a", [item({ label: "عادی", tone: "warn" })]),
      panel("b", [item({ label: "فوری", tone: "crit" })]),
    ];
    expect(mostUrgent(panels)?.label).toBe("فوری");
  });

  it("prefers a good-tone item LAST — a win is not an action", () => {
    expect(mostUrgent([panel("a", [item({ label: "خبر خوب", tone: "good" })])])).toBeNull();
  });

  it("skips an urgent item that has no href — a tappable row needs a destination", () => {
    const panels = [panel("a", [item({ label: "بدون مقصد", tone: "crit", href: undefined })])];
    expect(mostUrgent(panels)).toBeNull();
  });

  it("returns the item itself, not a copy", () => {
    const target = item({ label: "کار", tone: "crit" });
    expect(mostUrgent([panel("a", [target])])).toBe(target);
  });

  it("cardFor gives a count and the one named item together", () => {
    const card = cardFor([
      panel("a", [item({ label: "الف", tone: "warn" }), item({ label: "ب", tone: "crit" })]),
    ]);
    expect(card).not.toBeNull();
    expect(card!.count).toBe(2);
    expect(card!.urgent?.label).toBe("ب");
  });

  it("cardFor is null when nothing is urgent — the card must not render at all", () => {
    expect(cardFor([panel("a", [item({ tone: "info" })])])).toBeNull();
  });

  /* Beyond the plan's nine. */

  it("an item with NO tone at all is not a demand", () => {
    // `tone` is optional on BriefingItem, so an item built without one is the most likely
    // accidental way for a count to inflate. "no tone" is not "urgent".
    expect(needsAttention([panel("a", [{ label: "بی‌تنظیم" }])])).toBe(0);
    expect(mostUrgent([panel("a", [{ label: "بی‌تنظیم" }])])).toBeNull();
  });

  it("counts an untappable urgent item even though it cannot be the one to act on", () => {
    // The count is "how many are waiting on you" and it is true either way. The named item
    // is a different question with a stricter rule. Conflating them would either hide work
    // or point at a row that goes nowhere.
    const panels = [panel("a", [item({ label: "بدون مقصد", tone: "crit", href: undefined })])];
    expect(needsAttention(panels)).toBe(1);
    const card = cardFor(panels)!;
    expect(card.count).toBe(1);
    expect(card.urgent).toBeNull();
  });

  it("falls through an untappable crit to a tappable warn", () => {
    const panels = [
      panel("a", [item({ label: "بی‌مقصد", tone: "crit", href: undefined })]),
      panel("b", [item({ label: "قابل‌اقدام", tone: "warn", href: "/y" })]),
    ];
    expect(mostUrgent(panels)?.label).toBe("قابل‌اقدام");
  });

  it("within one tone, the FIRST listed wins — briefing.ts already orders by importance", () => {
    const panels = [
      panel("a", [item({ label: "اول", tone: "warn" }), item({ label: "دوم", tone: "warn" })]),
    ];
    expect(mostUrgent(panels)?.label).toBe("اول");
  });

  it("an empty href string is not a destination", () => {
    const panels = [panel("a", [item({ label: "خالی", tone: "crit", href: "" })])];
    expect(mostUrgent(panels)).toBeNull();
  });

  it("reads `more` as work still waiting, not as absent work", () => {
    // `panel()` caps at five and records the remainder in `more`. A panel showing 5 of 12
    // still has 12 things waiting, so counting only the rendered rows would tell a reader
    // with nine outstanding items that they have five.
    const capped: BriefingPanel = {
      key: "a",
      title: "a",
      items: [item({ tone: "warn" }), item({ tone: "warn" })],
      more: 3,
    };
    expect(needsAttention([capped])).toBe(5);
  });

  it("counts across every panel, not just the first", () => {
    const panels = [
      panel("a", [item({ tone: "warn" })]),
      panel("b", [item({ tone: "crit" }), item({ tone: "warn" })]),
      panel("c", [item({ tone: "warn" }), item({ tone: "warn" })]),
    ];
    expect(needsAttention(panels)).toBe(5);
  });

  it("does not mutate the panels it is given", () => {
    const panels = [panel("a", [item({ tone: "crit" })])];
    const before = JSON.stringify(panels);
    needsAttention(panels);
    mostUrgent(panels);
    cardFor(panels);
    expect(JSON.stringify(panels)).toBe(before);
  });

  it("cardFor and needsAttention can never disagree about the count", () => {
    for (const panels of [
      [],
      [panel("a", [])],
      [panel("a", [item({ tone: "info" })])],
      [panel("a", [item({ tone: "crit" }), item({ tone: "warn" })])],
      [panel("a", [item({ tone: "good" }), item({ tone: "warn" })])],
    ]) {
      const card = cardFor(panels);
      expect(card === null).toBe(needsAttention(panels) === 0);
      if (card) expect(card.count).toBe(needsAttention(panels));
    }
  });
});
