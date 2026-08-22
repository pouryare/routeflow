import { describe, it, expect } from "vitest";
import { parseDeliveryText, groupIntoStops } from "@/lib/deliveryParse";

const HEADER =
  "شماره سفارش\tتاریخ\tمشتری\tکالا\tتعداد بسته\tمبلغ قابل دریافت (تومان)\tآدرس تحویل\tشماره تماس\tوضعیت ارسال\tعرض جغرافیایی\tطول جغرافیایی\tکد مشتری\tلینک نقشه";

const ROW1 =
  "SO-1001\t2026-07-30\tرستوران نمونه\tکره گیاهی نام آور\t1\t528000\tدماوند - کوچه جهان\t9124845102\tدر انتظار\t35.685409\t52.017364\t130001\thttps://maps.google.com/?q=35.685409,52.017364";
const ROW2 =
  "SO-1001\t2026-07-30\tرستوران نمونه\tکره گیاهی مرحبا\t16\t7040000\tدماوند - کوچه جهان\t9124845102\tدر انتظار\t35.685409\t52.017364\t130001\thttps://maps.google.com/?q=35.685409,52.017364";
const ROW3 =
  "SO-1002\t2026-07-30\tکبابسرا\tکره حیوانی نام آور\t2\t880000\t\t9192398643\tدر انتظار\t\t\t130002\t";

describe("parseDeliveryText", () => {
  it("skips the header row and parses data rows", () => {
    const lines = parseDeliveryText(`${HEADER}\n${ROW1}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      orderNo: "SO-1001",
      customerName: "رستوران نمونه",
      product: "کره گیاهی نام آور",
      qty: 1,
      amount: 528000,
      customerCode: "130001",
    });
  });

  it("works without a header row too", () => {
    const lines = parseDeliveryText(ROW1);
    expect(lines).toHaveLength(1);
  });

  it("ignores blank lines", () => {
    const lines = parseDeliveryText(`${HEADER}\n${ROW1}\n\n\n${ROW2}`);
    expect(lines).toHaveLength(2);
  });

  it("drops rows with no order number and no amount (stray text, not a delivery line)", () => {
    const lines = parseDeliveryText(`${HEADER}\nصرفا یک یادداشت بدون ساختار مشخص`);
    expect(lines).toHaveLength(0);
  });

  it("tolerates missing coordinate columns", () => {
    const lines = parseDeliveryText(ROW3);
    expect(lines[0].lat).toBeNull();
    expect(lines[0].lng).toBeNull();
    expect(lines[0].amount).toBe(880000);
  });
});

describe("groupIntoStops", () => {
  it("collapses multiple product lines for the same order into one stop", () => {
    const lines = parseDeliveryText(`${HEADER}\n${ROW1}\n${ROW2}\n${ROW3}`);
    const stops = groupIntoStops(lines);
    expect(stops).toHaveLength(2);
    const restaurant = stops.find((s) => s.customerName === "رستوران نمونه")!;
    expect(restaurant.items).toHaveLength(2);
    expect(restaurant.totalAmount).toBe(528000 + 7040000);
    expect(restaurant.orderNos).toEqual(["SO-1001"]);
  });

  it("groups by customer code when present, not by name text alone", () => {
    const lines = parseDeliveryText(`${HEADER}\n${ROW1}\n${ROW3}`);
    const stops = groupIntoStops(lines);
    expect(stops.map((s) => s.key).sort()).toEqual(["130001", "130002"]);
  });
});
