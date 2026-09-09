import { describe, it, expect } from "vitest";
import { ICONS, ICON_PX, ICON_STROKE, resolveIcon, type IconName } from "@/components/meridian/icon-map";

/** Icon is a thin wrapper over lucide-react; the logic worth testing is the name→glyph
 *  map, the tokenised sizing, and the decorative-vs-labelled aria split. */
describe("meridian/Icon resolver", () => {
  it("every mapped name resolves to a renderable component", () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const r = resolveIcon(name);
      expect(typeof r.Comp === "function" || typeof r.Comp === "object").toBe(true);
    }
  });

  it("size is the token in px, never a raw value", () => {
    expect(resolveIcon("truck", "sm").size).toBe(ICON_PX.sm);
    expect(resolveIcon("truck", "md").size).toBe(ICON_PX.md);
    expect(resolveIcon("truck", "lg").size).toBe(ICON_PX.lg);
    expect(resolveIcon("truck").size).toBe(ICON_PX.md); // default
  });

  it("stroke weight is the single fixed value", () => {
    expect(resolveIcon("bell").strokeWidth).toBe(ICON_STROKE);
  });

  it("no label → decorative (aria-hidden, no role)", () => {
    const r = resolveIcon("bell");
    expect(r["aria-hidden"]).toBe(true);
    expect(r["aria-label"]).toBeUndefined();
    expect(r.role).toBeUndefined();
  });

  it("label → image with an accessible name, not hidden", () => {
    const r = resolveIcon("bell", "md", "اعلان‌ها");
    expect(r["aria-hidden"]).toBeUndefined();
    expect(r["aria-label"]).toBe("اعلان‌ها");
    expect(r.role).toBe("img");
  });
});
