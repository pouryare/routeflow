import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LiveConnectionsCard from "@/components/meridian/LiveConnectionsCard";

const row = (o: Partial<Parameters<typeof LiveConnectionsCard>[0]["rows"][number]>) => ({
  id: "x", user_id: 7, name: "رضا", device: "Mozilla/5.0 (Linux; Android 14)", opened_at: "2026-11-09T08:12:00.000Z", last_seen: "2026-11-09T09:00:00.000Z", slow: false, ...o,
});

describe("who is connected card (L8)", () => {
  it("reads well when nobody is connected", () => {
    expect(renderToStaticMarkup(h(LiveConnectionsCard, { rows: [] }))).toContain("الان کسی برنامه را باز ندارد");
  });
  it("counts people once, names a display screen, and marks a slow phone", () => {
    const out = renderToStaticMarkup(
      h(LiveConnectionsCard, { rows: [row({ id: "a" }), row({ id: "b", slow: true }), row({ id: "c", user_id: null, name: null })] })
    );
    expect(out).toContain("۱ نفر · ۳ اتصال");
    expect(out).toContain("صفحهٔ نمایش");
    expect(out).toContain("کند، عقب مانده");
    expect(out).toContain("Android");
  });
});
