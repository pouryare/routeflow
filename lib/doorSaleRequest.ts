/** The body the door-sale and sample routes read, checked once. Plain data in, plain data out: no database. */

export interface DoorRequest {
  customer_id: number;
  lines: { product_id: number; packaging_id: number; packs: number }[];
  collected_toman: number;
  client_uuid: string | null;
  note: string | null;
}

const UUID = /^[A-Za-z0-9_-]{8,64}$/;

export function parseDoorRequest(body: unknown): { ok: true; value: DoorRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const customer = Number(b.customer_id);
  if (!Number.isInteger(customer) || customer < 1) return { ok: false, error: "مشتری انتخاب نشده است" };
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 50) return { ok: false, error: "قلمی مشخص نشده" };
  const lines = [];
  for (const l of b.lines as Record<string, unknown>[]) {
    const product_id = Number(l?.product_id);
    const packaging_id = Number(l?.packaging_id);
    const packs = Number(l?.packs);
    if (!Number.isInteger(product_id) || !Number.isInteger(packaging_id) || !Number.isInteger(packs) || product_id < 1 || packaging_id < 1 || packs < 1) {
      return { ok: false, error: "قلم نامعتبر است" };
    }
    lines.push({ product_id, packaging_id, packs });
  }
  const collected = b.collected_toman === undefined ? 0 : Number(b.collected_toman);
  if (!Number.isFinite(collected)) return { ok: false, error: "مبلغ دریافتی معتبر نیست" };
  if (b.client_uuid != null && !(typeof b.client_uuid === "string" && UUID.test(b.client_uuid))) return { ok: false, error: "شناسهٔ درخواست نامعتبر است" };
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  return { ok: true, value: { customer_id: customer, lines, collected_toman: collected, client_uuid: (b.client_uuid as string | null | undefined) ?? null, note } };
}
