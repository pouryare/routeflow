// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ShareholdersPanel from "@/components/accounting/ShareholdersPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  document.body.replaceChildren();
});

async function mount(props: Partial<React.ComponentProps<typeof ShareholdersPanel>> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ShareholdersPanel, {
      legalForm: "unregistered", shareholders: [], groups: [], users: [], scopes: { company: [] }, today: "2026-10-28", ...props,
    }));
  });
  return container;
}

describe("ShareholdersPanel", () => {
  it("says there are no shareholders yet and offers the one action", async () => {
    const c = await mount();
    expect(c.textContent).toContain("هنوز شریکی ثبت نشده");
    expect(c.textContent).toContain("افزودن شریک");
    expect(c.textContent).not.toContain("تنظیم درصد سهم‌ها");
  });

  it("lists each shareholder with today's share and owns the page's primary bar", async () => {
    const c = await mount({
      shareholders: [{ id: 1, name: "علی", userId: null }, { id: 2, name: "سارا", userId: 7 }],
      scopes: { company: [{ partyId: 1, percentBp: 6000 }, { partyId: 2, percentBp: 4000 }] },
    });
    expect(c.textContent).toContain("علی");
    expect(c.textContent).toContain("۶۰٪");
    expect(c.textContent).toContain("۴۰٪");
    expect(c.textContent).toContain("با ورود به سامانه");
    expect(c.querySelector("[data-has-primary-bar]")).not.toBeNull();
  });
});
