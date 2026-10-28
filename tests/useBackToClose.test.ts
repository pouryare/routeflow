import { describe, expect, it, vi } from "vitest";
import { trapBack } from "@/lib/useBackToClose";

/** A history stack and a popstate bus, enough to play back presses through trapBack. */
function fakeBrowser() {
  const stack: unknown[] = [{ __NA: true }];
  let at = 0;
  const handlers = new Set<() => void>();
  const hist = {
    get state() { return stack[at]; },
    pushState(s: unknown) { stack.splice(at + 1); stack.push(s); at++; },
    back() { if (at > 0) { at--; handlers.forEach((h) => h()); } },
  };
  const target = {
    addEventListener: (_: string, h: () => void) => { handlers.add(h); },
    removeEventListener: (_: string, h: () => void) => { handlers.delete(h); },
  };
  return { hist, target, depth: () => at };
}

describe("trapBack", () => {
  it("back closes the overlay and leaves no extra entry", () => {
    const b = fakeBrowser();
    const close = vi.fn();
    const release = trapBack(b.hist as never, b.target as never, close);
    expect(b.depth()).toBe(1);
    b.hist.back();
    expect(close).toHaveBeenCalledOnce();
    release();
    expect(b.depth()).toBe(0);
  });

  it("closing another way pops its own entry", () => {
    const b = fakeBrowser();
    const close = vi.fn();
    trapBack(b.hist as never, b.target as never, close)();
    expect(b.depth()).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("nested: back closes only the top overlay", () => {
    const b = fakeBrowser();
    const outer = vi.fn();
    const inner = vi.fn();
    trapBack(b.hist as never, b.target as never, outer);
    trapBack(b.hist as never, b.target as never, inner);
    b.hist.back();
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("an entry left behind by a navigation is skipped on the way back", () => {
    const b = fakeBrowser();
    const release = trapBack(b.hist as never, b.target as never, vi.fn());
    b.hist.pushState({ __NA: true, page: "next" }); // a link inside the sheet navigated
    release(); // the sheet closes: its entry is no longer on top, so it stays
    expect(b.depth()).toBe(2);
    b.hist.back(); // lands on the dead entry and steps over it
    expect(b.depth()).toBe(0);
  });
});

describe("trapBack, when the overlay asks first", () => {
  it("stays open on the first back and closes on the second", () => {
    const b = fakeBrowser();
    let asked = false;
    const close = vi.fn(() => { if (!asked) { asked = true; return false; } return true; });
    trapBack(b.hist as never, b.target as never, close);
    b.hist.back();
    expect(close).toHaveBeenCalledOnce();
    expect(b.depth()).toBe(1); // re-armed
    b.hist.back();
    expect(close).toHaveBeenCalledTimes(2);
    expect(b.depth()).toBe(0);
  });
});
