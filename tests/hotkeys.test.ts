import { describe, it, expect } from "vitest";
import {
  buildRegistry,
  conflicts,
  helpRows,
  eventMatchesChord,
  bindingFor,
  isTypingTarget,
  isReservedChord,
  runnableBindings,
  type Binding,
} from "@/lib/hotkeys";

const b = (over: Partial<Binding> = {}): Binding => ({
  keys: "K",
  description: "کاری",
  routes: ["/sales"],
  order: 50,
  ...over,
});

describe("the hotkey registry", () => {
  it("keeps two different keys that happen to share a description", () => {
    const reg = buildRegistry([b({ keys: "K" }), b({ keys: "J" })]);
    expect(reg).toHaveLength(2);
    expect(conflicts(reg)).toEqual([]);
  });

  it("reports the SAME key bound twice on overlapping routes", () => {
    // The failure this whole file exists to prevent: two listeners, both firing, the second
    // winning silently.
    const reg = buildRegistry([b({ keys: "K", description: "یک" }), b({ keys: "k", description: "دو" })]);
    expect(conflicts(reg).length).toBe(1);
    expect(conflicts(reg)[0].routes).toContain("/sales");
  });

  it("does NOT report a conflict when the routes do not overlap", () => {
    const reg = buildRegistry([
      b({ keys: "K", routes: ["/sales"], description: "یک" }),
      b({ keys: "K", routes: ["/map"], description: "دو" }),
    ]);
    expect(conflicts(reg)).toEqual([]);
  });

  it("matches a key case-insensitively, because e.key is not normalised", () => {
    expect(conflicts(buildRegistry([b({ keys: "K" }), b({ keys: "k" })]))).toHaveLength(1);
  });

  it("supports a modifier prefix and treats Cmd and Ctrl as the same chord", () => {
    const reg = buildRegistry([
      b({ keys: "Mod+K", routes: ["/sales"], description: "جستجو" }),
      b({ keys: "Ctrl+K", routes: ["/sales"], description: "دوباره" }),
    ]);
    expect(conflicts(reg)).toHaveLength(1);
  });

  it("filters to the bindings live on a given route", () => {
    const reg = buildRegistry([
      b({ keys: "K", routes: ["/sales"] }),
      b({ keys: "G", routes: ["/map"] }),
    ]);
    expect(helpRows(reg, "/sales").map((r) => r.keys)).toEqual(["K"]);
  });

  it("orders help rows the way the app reads, not alphabetically", () => {
    const reg = buildRegistry([
      b({ keys: "Mod+K", routes: ["/x"], order: 1 }),
      b({ keys: "?", routes: ["/x"], order: 90 }),
      b({ keys: "S", routes: ["/x"], order: 5 }),
    ]);
    expect(helpRows(reg, "/x").map((r) => r.order)).toEqual([1, 5, 90]);
  });

  it("an empty registry produces no help rows and no crash", () => {
    expect(helpRows([], "/sales")).toEqual([]);
  });

  it("an undescribed binding is still a conflict, and is NOT a help row", () => {
    // Both bindings here are undescribed, so the conflict is real but the cheatsheet has
    // nothing to say. An earlier draft of this test gave the SECOND one a description and
    // then expected zero rows — which would have been asserting that a labelled shortcut is
    // hidden, i.e. the opposite of what this rule is for.
    const reg = buildRegistry([b({ keys: "K", description: "" }), b({ keys: "k", description: "  " })]);
    expect(conflicts(reg)).toHaveLength(1);
    expect(helpRows(reg, "/sales")).toEqual([]);
  });

  /* Beyond the plan's nine. */

  it("normalises modifier ORDER, so Ctrl+Shift+K and Shift+Ctrl+K collide", () => {
    const reg = buildRegistry([
      b({ keys: "Ctrl+Shift+K", routes: ["/x"], description: "یک" }),
      b({ keys: "Shift+Ctrl+K", routes: ["/x"], description: "دو" }),
    ]);
    expect(conflicts(reg)).toHaveLength(1);
  });

  it("does NOT treat Shift+K and K as the same chord — they are different keys", () => {
    // Sorting the parts is right for order, but a modifier must not be DROPPED. Collapsing
    // Shift+K into K would report a conflict where there is none and, worse, would make a
    // registry match the wrong physical key at runtime.
    const reg = buildRegistry([
      b({ keys: "Shift+K", routes: ["/x"], description: "یک" }),
      b({ keys: "K", routes: ["/x"], description: "دو" }),
    ]);
    expect(conflicts(reg)).toEqual([]);
  });

  it("treats a nested route as overlapping its parent — /sales/leads covers /sales", () => {
    // /sales/leads is a CHILD of /sales. Two components claiming K on each are in conflict
    // the moment someone opens the leads page, which is the exact bug this prevents.
    const reg = buildRegistry([
      b({ keys: "K", routes: ["/sales"], description: "یک" }),
      b({ keys: "K", routes: ["/sales/leads"], description: "دو" }),
    ]);
    expect(conflicts(reg)).toHaveLength(1);
  });

  it("an empty routes array means EVERYWHERE, so it overlaps everything", () => {
    const reg = buildRegistry([
      b({ keys: "K", routes: [], description: "سراسری" }),
      b({ keys: "K", routes: ["/map"], description: "نقشه" }),
    ]);
    expect(conflicts(reg)).toHaveLength(1);
  });

  it("helpRows includes an everywhere binding on every route", () => {
    const reg = buildRegistry([
      b({ keys: "?", routes: [], description: "راهنما", order: 1 }),
      b({ keys: "K", routes: ["/sales"], description: "کاری", order: 2 }),
    ]);
    expect(helpRows(reg, "/map").map((r) => r.keys)).toEqual(["?"]);
    expect(helpRows(reg, "/sales").map((r) => r.keys)).toEqual(["?", "K"]);
  });

  it("helpRows does NOT leak a child route's binding onto its parent", () => {
    // The mirror of the overlap rule: a binding scoped to /sales/leads must not appear on
    // /sales, or the cheatsheet would promise a key that does nothing there.
    const reg = buildRegistry([b({ keys: "L", routes: ["/sales/leads"], description: "سرنخ" })]);
    expect(helpRows(reg, "/sales")).toEqual([]);
    expect(helpRows(reg, "/sales/leads")).toHaveLength(1);
    expect(helpRows(reg, "/sales/leads/7")).toHaveLength(1);
  });

  it("a whitespace-only description is not a help row either", () => {
    const reg = buildRegistry([b({ keys: "K", routes: ["/x"], description: "   " })]);
    expect(helpRows(reg, "/x")).toEqual([]);
  });

  it("reports EVERY conflicting pair, not just the first", () => {
    const reg = buildRegistry([
      b({ keys: "K", routes: ["/x"], description: "۱" }),
      b({ keys: "k", routes: ["/x"], description: "۲" }),
      b({ keys: "K", routes: ["/x"], description: "۳" }),
    ]);
    expect(conflicts(reg)).toHaveLength(3); // (1,2) (1,3) (2,3)
  });

  it("does not mutate the bindings it is given", () => {
    const input = [b({ keys: "B", order: 9 }), b({ keys: "A", order: 1 })];
    const before = JSON.stringify(input);
    buildRegistry(input);
    conflicts(input);
    helpRows(input, "/sales");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("never returns the caller's array, so a caller cannot mutate the registry", () => {
    const input = [b()];
    const reg = buildRegistry(input);
    reg.push(b({ keys: "Z" }));
    expect(buildRegistry(input)).toHaveLength(1);
  });

});

/** The runtime half. The plan shipped no tests for it, which is the half that decides whether
 *  a shortcut actually fires — a chord that normalises correctly and then matches the wrong
 *  key event is a shortcut that silently does nothing. */
describe("matching a real key event", () => {
  const ev = (o: Partial<KeyboardEvent> = {}) =>
    ({ key: "k", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;

  it("matches a bare letter", () => {
    expect(eventMatchesChord(ev(), "K")).toBe(true);
    expect(eventMatchesChord(ev(), "k")).toBe(true);
    expect(eventMatchesChord(ev({ key: "j" }), "K")).toBe(false);
  });

  it("Mod matches on Mac meta and on Windows ctrl — one binding, both platforms", () => {
    expect(eventMatchesChord(ev({ metaKey: true }), "Mod+K")).toBe(true);
    expect(eventMatchesChord(ev({ ctrlKey: true }), "Mod+K")).toBe(true);
    expect(eventMatchesChord(ev(), "Mod+K")).toBe(false);
  });

  it("Shift+K does not match a bare K", () => {
    // The bug the two tests above exist to prevent: collapsing the modifier would make the
    // shifted chord fire on the unshifted key.
    expect(eventMatchesChord(ev({ shiftKey: true }), "Shift+K")).toBe(true);
    expect(eventMatchesChord(ev({ shiftKey: true }), "K")).toBe(false);
  });

  it("accepts either spelling of the ? key", () => {
    expect(eventMatchesChord(ev({ key: "?", shiftKey: true }), "?")).toBe(true);
    expect(eventMatchesChord(ev({ key: "?", shiftKey: true }), "Shift+/")).toBe(true);
  });

  it("a lone modifier is not a bindable chord", () => {
    expect(eventMatchesChord(ev({ key: "Shift" }), "Shift")).toBe(false);
    expect(eventMatchesChord(ev(), "Mod")).toBe(false);
  });

  it("does not throw on an event with no key", () => {
    expect(eventMatchesChord({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false } as KeyboardEvent, "K")).toBe(false);
  });
});

/** What the ONE listener does. These are the rules that decide whether a keystroke reaches
 *  the app or is swallowed, and the plan specified them only in prose inside the component. */
describe("dispatching a keystroke", () => {
  const run = (over: Partial<Binding> = {}) => b({ order: 1, ...over });
  const ev = (o: Partial<KeyboardEvent> = {}) =>
    ({ key: "k", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;

  it("fires the binding live on this route", () => {
    let fired = 0;
    const hit = bindingFor([run({ keys: "K", routes: ["/sales"], run: () => fired++ })], "/sales", ev());
    expect(hit).not.toBeNull();
    hit!.run!();
    expect(fired).toBe(1);
  });

  it("does not fire a binding scoped to another route", () => {
    const hit = bindingFor([run({ keys: "K", routes: ["/map"], run: () => {} })], "/sales", ev());
    expect(hit).toBeNull();
  });

  it("a documentation-only binding is never fired, even when it matches", () => {
    // No `run` means the entry documents a key that already has its own listener. Firing it
    // here would double-handle it.
    const doc = run({ keys: "K", routes: ["/sales"] });
    expect(doc.run).toBeUndefined();
    expect(bindingFor([doc], "/sales", ev())).toBeNull();
    expect(runnableBindings([doc])).toEqual([]);
  });

  it("a runnable binding WINS over a documentation-only one on the same chord", () => {
    // The map documents "?" and the help dialog really handles it. If the documented entry
    // were consulted first it would shadow the real one and "?" would silently stop working.
    const doc = run({ keys: "?", routes: ["/map"], order: 1 });
    let fired = 0;
    const real = run({ keys: "?", routes: ["/map"], order: 2, run: () => fired++ });
    const hit = bindingFor([doc, real], "/map", ev({ key: "?", shiftKey: true }));
    expect(hit).toBe(real);
    hit!.run!();
    expect(fired).toBe(1);
  });

  it("leaves Tab, Escape, Enter and the function keys to the browser", () => {
    // Hijacking Escape is how a dialog stops closing, and Tab is how anyone moves focus.
    for (const key of ["Tab", "Escape", "Enter", "F5", "F12"]) {
      expect(isReservedChord(ev({ key })), `${key} was hijackable`).toBe(true);
    }
  });

  it("does not reserve ordinary keys", () => {
    for (const key of ["k", "K", "?", "/", "s", "g"]) {
      expect(isReservedChord(ev({ key })), `${key} was wrongly reserved`).toBe(false);
    }
  });

  it("recognises a text field so a shortcut never eats a typed letter", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTypingTarget({ tagName: tag } as unknown as EventTarget), tag).toBe(true);
    }
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
