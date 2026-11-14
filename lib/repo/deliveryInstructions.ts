import { getDb } from "@/lib/db";

/** F69: saves the driver's standing note for a customer; returns the problem in words, or null once saved. */
export async function setDeliveryInstructions(orgId: number, customerId: number, text: string): Promise<string | null> {
  const t = text.trim();
  if (t.length > 200) return "نکته از ۲۰۰ نویسه بیشتر است";
  const r = await getDb().prepare("UPDATE customers SET delivery_instructions = ? WHERE id = ? AND organization_id = ?").run(t === "" ? null : t, customerId, orgId);
  return Number(r.changes ?? 0) > 0 ? null : "مشتری پیدا نشد";
}
