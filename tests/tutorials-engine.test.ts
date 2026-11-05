import { describe, it, expect } from "vitest";
import { firstSteps, foldPersian, isProgress, mayOffer, offerFor, searchTutorials, wantsGhost, withDone, withOffer } from "@/lib/tutorials/engine";
import { namesDemoRecord, pretendFor } from "@/lib/tutorials/pretend";
import { TUTORIALS, TUTORIAL_IDS } from "@/lib/tutorials/catalog";
import type { Tutorial } from "@/lib/tutorials/types";
import { ROLES } from "@/lib/roles";

const t = (id: string, screen: string, extra: Partial<Tutorial> = {}): Tutorial => ({ id, title: id, roles: ["delivery_driver"], screen, steps: [{ text: "x" }], ...extra });

describe("tutorials: when the chip asks (idea I1)", () => {
  it("asks the first time, once more on a later day, then never", () => {
    expect(mayOffer({}, "a", "2026-11-05")).toBe(true);
    expect(mayOffer({ offered: { a: ["2026-11-05"] } }, "a", "2026-11-05")).toBe(false);
    expect(mayOffer({ offered: { a: ["2026-11-05"] } }, "a", "2026-11-06")).toBe(true);
    expect(mayOffer({ offered: { a: ["2026-11-05", "2026-11-06"] } }, "a", "2026-12-01")).toBe(false);
    expect(mayOffer({ done: ["a"] }, "a", "2026-11-05")).toBe(false);
  });

  it("records an offer once a day and at most twice", () => {
    const p1 = withOffer({}, "a", "2026-11-05");
    expect(withOffer(p1, "a", "2026-11-05")).toBe(p1);
    const p2 = withOffer(p1, "a", "2026-11-06");
    expect(p2.offered?.a).toEqual(["2026-11-05", "2026-11-06"]);
    expect(withOffer(p2, "a", "2026-11-07")).toBe(p2);
  });

  it("offers the most specific screen's tutorial for this role only", () => {
    const all = [t("run", "/driver"), t("pay", "/sales/payments", { roles: ["phone_sales"] }), t("sales", "/sales", { roles: ["phone_sales"] })];
    expect(offerFor("/driver", "delivery_driver", {}, "2026-11-05", all)?.id).toBe("run");
    expect(offerFor("/sales/payments/new", "phone_sales", {}, "2026-11-05", all)?.id).toBe("pay");
    expect(offerFor("/salesx", "phone_sales", {}, "2026-11-05", all)).toBeNull();
    expect(offerFor("/sales/payments", "delivery_driver", {}, "2026-11-05", all)).toBeNull();
  });
});

describe("tutorials: done, first steps, ghost", () => {
  it("marks done once and counts the role's first steps", () => {
    const all = [t("a", "/driver", { firstSteps: true }), t("b", "/driver", { firstSteps: true }), t("c", "/driver")];
    const p = withDone(withDone({}, "a"), "a");
    expect(p.done).toEqual(["a"]);
    expect(firstSteps("delivery_driver", p, all)).toMatchObject({ done: 1, total: 2, complete: false });
    expect(firstSteps("delivery_driver", withDone(p, "b"), all).complete).toBe(true);
  });

  it("plays the ghost hand only for jobs of three taps or more (idea I5)", () => {
    expect(wantsGhost(t("a", "/", { steps: [{ text: "1", target: "x" }, { text: "2", target: "y" }] }))).toBe(false);
    expect(wantsGhost(t("a", "/", { steps: [{ text: "1", target: "x" }, { text: "2", target: "y" }, { text: "3", target: "z" }] }))).toBe(true);
    expect(wantsGhost(t("a", "/", { steps: [{ text: "1", target: "x" }, { text: "2", target: "y" }, { text: "3", target: "z", advance: "next" }] }))).toBe(false);
  });
});

describe("tutorials: «چطور…؟» search (idea I2)", () => {
  const all = [t("cheque", "/driver", { title: "ثبت چک", keywords: ["چک برگشتی"] }), t("cash", "/driver", { title: "گرفتن پول نقد" })];
  it("folds Arabic letters and the half-space and ignores «چطور»", () => {
    expect(foldPersian("ثبت‌چك  ي")).toBe("ثبت چک ی");
    expect(searchTutorials("چطور چك ثبت کنم؟", "delivery_driver", all).map((x) => x.id)).toEqual([]);
    expect(searchTutorials("چطور ثبت چك؟", "delivery_driver", all).map((x) => x.id)).toEqual(["cheque"]);
    expect(searchTutorials("برگشتی", "delivery_driver", all).map((x) => x.id)).toEqual(["cheque"]);
    expect(searchTutorials("  ", "delivery_driver", all)).toEqual([]);
    expect(searchTutorials("چک", "phone_sales", all)).toEqual([]);
  });
});

describe("tutorials: what may be stored in prefs", () => {
  const known = new Set(["a", "b"]);
  it("takes the known shape and refuses anything else", () => {
    expect(isProgress({ done: ["a"], offered: { b: ["2026-11-05"] }, celebrated: ["delivery_driver"] }, known)).toBe(true);
    expect(isProgress({ done: ["zzz"] }, known)).toBe(false);
    expect(isProgress({ offered: { a: ["2026-11-05", "2026-11-06", "2026-11-07"] } }, known)).toBe(false);
    expect(isProgress({ offered: { a: ["yesterday"] } }, known)).toBe(false);
    expect(isProgress({ extra: 1 }, known)).toBe(false);
    expect(isProgress([], known)).toBe(false);
    expect(isProgress(null, known)).toBe(false);
  });
});

describe("tutorials: pretend saves (plan section 11)", () => {
  it("fakes every API write and every read of a demo record, and lets the rest through", () => {
    expect(pretendFor("POST", "/api/payments")).toBe("fake");
    expect(pretendFor("PATCH", "http://host/api/sales/orders/12")).toBe("fake");
    expect(pretendFor("GET", "/api/sales/orders/12")).toBe("pass");
    expect(pretendFor("GET", "/api/sales/orders/demo-3")).toBe("fake");
    expect(pretendFor("GET", "/api/driver/stops/-1")).toBe("fake");
    expect(pretendFor("PATCH", "/api/prefs")).toBe("pass");
    expect(pretendFor("POST", "/api/tutorials/stats")).toBe("pass");
    expect(pretendFor("POST", "/sales/orders")).toBe("pass");
  });

  it("the server lock refuses any address that names a demo record", () => {
    expect(namesDemoRecord("/api/driver/stops/-1")).toBe(true);
    expect(namesDemoRecord("/api/sales/orders/demo-2/lines")).toBe(true);
    expect(namesDemoRecord("/api/sales/orders/12")).toBe(false);
    expect(namesDemoRecord("/driver")).toBe(false);
  });
});

describe("tutorials: the catalogue", () => {
  it("has unique, storable ids, real roles, and at least one step each", () => {
    expect(TUTORIAL_IDS.size).toBe(TUTORIALS.length);
    for (const x of TUTORIALS) {
      expect(x.id).toMatch(/^[a-z0-9-]{1,60}$/);
      expect(x.steps.length).toBeGreaterThan(0);
      expect(x.steps.length).toBeLessThanOrEqual(8);
      for (const r of x.roles) expect(ROLES).toContain(r);
      expect(x.screen.startsWith("/")).toBe(true);
    }
  });

  it("never lets a real-save tutorial touch money or messages", () => {
    for (const x of TUTORIALS.filter((y) => y.real)) {
      expect(`${x.id} ${x.title}`).not.toMatch(/pay|cash|cheque|sms|پول|چک|پیامک|پرداخت/);
    }
  });
});
