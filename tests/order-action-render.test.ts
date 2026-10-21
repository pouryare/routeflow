import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ToastProvider";
import OrderActionFlow from "@/components/flows/OrderActionFlow";
import ConfirmOrderButton from "@/components/sales/ConfirmOrderButton";
import OrderStatusPanel from "@/components/sales/OrderStatusPanel";
import { legalOrderActions } from "@/lib/orderStateMachine";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const wrap = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(ToastProvider, null, el));

describe("order status actions", () => {
  it("the reason sheet asks «چرا؟» and names the action", () => {
    const h = wrap(createElement(OrderActionFlow, { open: true, orderId: 1, action: "cancel", onDone: () => {}, onClose: () => {} }));
    expect(h).toContain("چرا؟");
    expect(h).toContain("لغو سفارش");
  });

  it("confirming is one tap with an undo, not a second «are you sure?» tap", () => {
    const h = wrap(createElement(ConfirmOrderButton, { orderId: 1 }));
    expect(h).toContain("تأیید سفارش");
    expect(h).toContain("تا ۵ ثانیه می‌توانید پشیمان شوید");
    expect(h).not.toContain("انصراف از تأیید سفارش");
  });

  it("the status panel offers each legal action as a 44px button", () => {
    const actions = legalOrderActions("CONFIRMED", "owner").filter((a) => a !== "flagCredit");
    expect(actions.length).toBeGreaterThan(0);
    const h = wrap(createElement(OrderStatusPanel, { orderId: 1, status: "CONFIRMED", role: "owner" }));
    expect(h).toContain("min-h-[44px]");
    expect(h).toContain("لغو سفارش");
  });
});
