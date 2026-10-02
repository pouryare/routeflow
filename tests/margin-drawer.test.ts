// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import MarginHelperDrawer, { type DrawerProduct } from "@/components/sales/MarginHelperDrawer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const product: DrawerProduct = {
  id: 1,
  name: "دوغ لیوانی",
  kg_per_base_unit: 0.25,
  avg_cost_toman: 300_000,
  cost_toman: 300_000,
  cost_method: "weighted_average",
  packagings: [{ id: 10, name: "جعبه ۲۴ تایی", price_toman: 440_000 }],
};

const fetchStub = () =>
  vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 5 }), { status: 201 }));

async function mount(props: Partial<React.ComponentProps<typeof MarginHelperDrawer>> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(MarginHelperDrawer, {
        products: [product],
        selectedProductId: "1",
        selectedPackagingId: "",
        price: "440000",
        onSelectProduct: () => {},
        onSelectPackaging: () => {},
        ...props,
      })
    );
  });
  // Most of what this drawer has to say is INSIDE the fold, so tests open it rather
  // than asserting against a collapsed summary that legitimately says almost nothing.
  const toggle = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("محاسبه سود")
  )!;
  await act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return container;
}

const text = (c: HTMLElement) => c.textContent ?? "";

describe("MarginHelperDrawer", () => {
  it("renders the summary and, opened, the full breakdown", async () => {
    const c = await mount();
    // Collapsed it says only what fits; opened it labels both ratios by name, because
    // the team uses "margin" and "markup" interchangeably and a bare number teaches
    // nothing. 440,000 against a 300,000 cost: margin is 31.8%, markup 46.7% -- and they
    // are DIFFERENT numbers, which is the whole reason both are on screen.
    expect(text(c)).toContain("حاشیه");
    expect(text(c)).toContain("سود روی بها");
    expect(text(c)).toContain("حاشیه هدف");
    expect(text(c)).toContain("۳۱٫۸");
    expect(text(c)).toContain("۴۶٫۷");
  });

  it("shows an em-dash, NOT a zero, for a field nobody has filled in", async () => {
    // The rule the whole drawer rests on. `toToman("")` returns null because "a silent
    // zero is how a free order gets recorded", and an unmeasured 0% must not be
    // indistinguishable from a measured one.
    const c = await mount();
    expect(text(c)).not.toContain("درصد فروش ۰");
    expect(text(c)).toMatch(/—|درصد فروش/);
  });

  it("never shows a margin at all when the cost is unknown", async () => {
    const c = await mount({
      products: [{ ...product, cost_toman: 0, avg_cost_toman: 0, cost_method: null }],
    });
    // Cost unknown is not cost zero. P = (C+F)/(1-a-m) would return a confident price
    // from overheads alone, so the drawer says the cost is unrecorded and shows no ratio.
    expect(text(c)).toContain("ثبت نشده");
    expect(text(c)).not.toContain("۳۱٫۸");
  });

  it("labels a moving-average cost as a moving average with its date", async () => {
    // avg_cost_toman moves on every purchase receipt, so an unqualified figure invites the
    // owner to compare it against last month's dashboard and conclude one is broken.
    const c = await mount();
    expect(text(c)).toContain("میانگین متحرک");
  });

  it("labels a landed cost as landed, not as an average", async () => {
    const c = await mount({
      products: [{ ...product, cost_toman: 400_000, cost_method: "landed" }],
    });
    expect(text(c)).toContain("تمام‌شده");
  });

  it("refuses rather than showing a price when no price can hit the target", async () => {
    const c = await mount();
    const input = c.querySelector('input[name="target"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    // 100% is not merely hard, it is IMPOSSIBLE: P = (C+F)/(1 - a - m) has a zero
    // denominator, so every price loses money. The drawer must say so rather than
    // printing a very large number. (95% would NOT refuse -- with no deductions that is
    // achievable, which is why this test uses 100.)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input!, "100");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text(c)).toContain("وجود ندارد");
    expect(text(c)).not.toMatch(/برای رسیدن به این حاشیه/);
  });

  it("does NOT call fetch for a price, ever -- it never writes one", async () => {
    const fetchMock = fetchStub();
    vi.stubGlobal("fetch", fetchMock);
    const c = await mount();
    await act(async () => {
      const input = c.querySelector('input[name="target"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("every control has an accessible name", async () => {
    const c = await mount();
    const nameless = [...c.querySelectorAll("button")].filter(
      (b) => !b.textContent?.trim() && !b.getAttribute("aria-label")
    );
    expect(nameless).toEqual([]);
  });

  it("uses no emoji -- Lucide through <Icon> only", async () => {
    const c = await mount();
    // The project rule: one library, reached one way. An emoji here fails the icon audit.
    expect(text(c)).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
