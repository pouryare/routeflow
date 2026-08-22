import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDeliveryText, parseDeliveryWorkbook, groupIntoStops, DeliveryStop } from "@/lib/deliveryParse";
import type { ResolvedStop } from "@/lib/deliveryTypes";

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  let stops: DeliveryStop[];

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      stops = groupIntoStops(await parseDeliveryWorkbook(buffer));
    } else {
      const body = await req.json().catch(() => null);
      const text = (body as { text?: string } | null)?.text;
      if (!text || !text.trim()) {
        return NextResponse.json({ ok: false, error: "متنی برای تجزیه وارد نشده است" }, { status: 400 });
      }
      stops = groupIntoStops(parseDeliveryText(text));
    }
  } catch {
    return NextResponse.json({ ok: false, error: "خطا در خواندن اطلاعات ارسال" }, { status: 422 });
  }

  if (stops.length === 0) {
    return NextResponse.json({ ok: false, error: "هیچ ردیف ارسال معتبری پیدا نشد" }, { status: 422 });
  }

  const db = getDb();
  const byCode = db.prepare("SELECT id, business_name, lat, lng FROM customers WHERE customer_code = ?");
  const byName = db.prepare("SELECT id, business_name, lat, lng FROM customers WHERE business_name = ?");

  const resolved: ResolvedStop[] = stops.map((stop) => {
    const row = (stop.customerCode ? byCode.get(stop.customerCode) : undefined) as
      | { id: number; business_name: string; lat: number | null; lng: number | null }
      | undefined;
    const match = row ?? (byName.get(stop.customerName) as typeof row | undefined);
    const resolvedLat = match?.lat ?? stop.lat;
    const resolvedLng = match?.lng ?? stop.lng;
    return {
      ...stop,
      customerId: match?.id ?? null,
      resolvedLat: resolvedLat ?? null,
      resolvedLng: resolvedLng ?? null,
      matched: !!match,
    };
  });

  return NextResponse.json({ ok: true, stops: resolved });
}
