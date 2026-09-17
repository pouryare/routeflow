import { describe, it, expect } from "vitest";
import { priceListText, shareUrl } from "@/lib/crm/share";

const products = [{ id: 1, name: "کره ۱۰ گرمی", price_toman: 185000 }, { id: 2, name: "پودر کاکائو", price_toman: null }];

describe("share", () => {
  it("lists the chosen products with prices, all when none chosen", () => {
    const text = priceListText(products, ["1"]);
    expect(text).toContain("• کره ۱۰ گرمی");
    expect(text).toContain("تومان");
    expect(priceListText(products, [])).toContain("• پودر کاکائو — استعلام");
  });
  it("builds WhatsApp and Telegram links", () => {
    expect(shareUrl("whatsapp", "9120001234", "سلام")).toBe("https://wa.me/989120001234?text=%D8%B3%D9%84%D8%A7%D9%85");
    expect(shareUrl("whatsapp", null, "سلام")).toBe("https://wa.me/?text=%D8%B3%D9%84%D8%A7%D9%85");
    expect(shareUrl("telegram", "9120001234", "سلام")).toBe("https://t.me/share/url?url=%20&text=%D8%B3%D9%84%D8%A7%D9%85");
  });
});
