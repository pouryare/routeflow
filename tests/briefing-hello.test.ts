import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* The DB preamble goes at the TOP, above every other import, because ROUTEFLOW_DB_PATH is
 * read once at module load — the same shape as tests/commissionLedger.test.ts. */
const testDbPath = path.join(
  os.tmpdir(),
  `briefing-hero-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;

const { getDb } = await import("@/lib/db");
const { todayFor } = await import("@/lib/repo/briefing");
const { setTarget } = await import("@/lib/repo/targets");
const { toJalali } = await import("@/lib/jalali");

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

let org = 0;
let manager = 0;
let driver = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  org = Number(
    (await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
      .run("B", `b-${Date.now()}`, now)).lastInsertRowid,
  );
  const group = Number(
    (await db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now)).lastInsertRowid,
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,organization_id,created_at) VALUES (?,?,?,?,?,?,?)",
  );
  manager = Number((await u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", group, org, now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x", "راننده", "delivery_driver", group, org, now)).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sessionFor = (userId: number, role: string) =>
  ({
    user: { id: userId, display_name: "x", avatar_url: null },
    role,
    organizationId: org,
    groupId: null,
    roles: [role],
  }) as never;

const thisPeriod = () => {
  const j = toJalali(new Date().toISOString())!;
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
};

describe("the briefing hero", () => {
  it("carries the person's id, so the avatar stays the same person in any role", async () => {
    expect((await todayFor(sessionFor(manager, "group_manager"))).hero).toMatchObject({
      userId: manager,
    });
  });

  it("gives a MANAGER the monthly target, not just phone_sales", async () => {
    await setTarget(org, {
      user_id: manager,
      period: thisPeriod(),
      metric: "revenue_toman",
      target_value: 5_000_000,
    });
    const b = await todayFor(sessionFor(manager, "group_manager"));
    expect(b.panels.some((p) => p.key === "target")).toBe(true);
  });

  it("a DRIVER with no run still gets a briefing, never a blank screen", async () => {
    expect((await todayFor(sessionFor(driver, "delivery_driver"))).panels.length).toBeGreaterThan(0);
  });

  it("the hero is present on the EMPTY-day path too, not only when panels exist", async () => {
    // The early return is the easiest path to forget when a payload grows, and a hero that
    // vanishes on a quiet day is worse than one that is never there: the layout shifts under
    // the reader exactly when they expect nothing to happen.
    const fresh = await todayFor(sessionFor(driver, "delivery_driver"));
    expect(fresh.hero).toBeTruthy();
    expect(fresh.hero.userId).toBe(driver);
    expect(fresh.hero.displayName).toBeTruthy();
  });

  it("the hero carries the name and role, so the page does not re-derive identity", async () => {
    const h = (await todayFor(sessionFor(manager, "group_manager"))).hero;
    expect(h.role).toBe("group_manager");
    expect(typeof h.displayName).toBe("string");
  });

  it("avatarUrl is null rather than undefined when nobody set a photo", async () => {
    // Both read as "no photo" to `Avatar`, but `undefined` is what a missing key produces
    // and it means the field is absent rather than answered. `JSON.stringify` drops it.
    const h = (await todayFor(sessionFor(manager, "group_manager"))).hero;
    expect(h.avatarUrl).toBeNull();
    expect(JSON.parse(JSON.stringify(h))).toHaveProperty("avatarUrl", null);
  });

  it("a target with no value adds NO panel, rather than a 0% one", async () => {
    // Nobody has set a target for the driver. A "۰٪ از ۰" card is noise that reads as a
    // failing goal, and the hero's number is already saying nothing needs attention.
    const b = await todayFor(sessionFor(driver, "delivery_driver"));
    expect(b.panels.some((p) => p.key === "target")).toBe(false);
  });

  it("the target panel's tone is good only when the goal is actually met", async () => {
    const b = await todayFor(sessionFor(manager, "group_manager"));
    const t = b.panels.find((p) => p.key === "target");
    expect(t).toBeDefined();
    // No orders have been sold in this fixture, so the fraction is 0 and the tone must not
    // be "good" — a green "done" against an unmet target is a lie on the hero screen.
    expect(t!.items[0].tone).not.toBe("good");
  });
});
