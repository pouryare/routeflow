import { afterEach, describe, expect, it, vi } from "vitest";
import { burst } from "@/lib/burst";

/** Just enough of an element for burst(): attributes and a layout read. */
function fakeEl() {
  const attrs = new Set<string>();
  return {
    attrs,
    offsetWidth: 0,
    setAttribute: (n: string) => attrs.add(n),
    removeAttribute: (n: string) => attrs.delete(n),
  } as unknown as HTMLElement & { attrs: Set<string> };
}

describe("burst", () => {
  afterEach(() => vi.useRealTimers());

  it("marks the element while the burst runs, then clears it", () => {
    vi.useFakeTimers();
    const el = fakeEl();
    burst(el);
    expect(el.attrs.has("data-burst")).toBe(true);
    vi.advanceTimersByTime(600);
    expect(el.attrs.has("data-burst")).toBe(false);
  });
});
