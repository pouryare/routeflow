import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";

export class ProductInfoError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface ProductInfoInput {
  category?: unknown;
  /** Up to three short lines. */
  selling_points?: unknown;
  how_to_say?: unknown;
  /** content_images.id of the product's picture, or null to remove it. */
  image_id?: unknown;
}

const text = (raw: unknown, max: number, what: string): string | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new ProductInfoError(`${what} نامعتبر است`);
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length > max) throw new ProductInfoError(`${what} حداکثر ${max} نویسه باشد`);
  return t || null;
};

/** What a rep says at the door about one product: group, up to three selling points, one line on how to say
 *  it, a picture. The caller has already checked the role; this checks the product and the picture belong to
 *  the company. Only the owner-side ever writes it; the van reads it. */
export async function setProductInfo(s: Session, productId: number, input: ProductInfoInput): Promise<void> {
  const db = getDb();
  const product = await db.prepare("SELECT 1 AS ok FROM products WHERE id = ? AND organization_id = ?").get(productId, s.organizationId);
  if (!product) throw new ProductInfoError("کالا پیدا نشد", 404);

  const points = Array.isArray(input.selling_points) ? input.selling_points : [];
  if (points.length > 3) throw new ProductInfoError("حداکثر سه نکتهٔ فروش");
  const lines = points.map((p) => text(p, 80, "نکتهٔ فروش")).filter((p): p is string => p !== null);

  const imageId = input.image_id === null || input.image_id === undefined ? null : Number(input.image_id);
  if (imageId !== null) {
    const img = await db.prepare("SELECT 1 AS ok FROM content_images WHERE id = ? AND organization_id = ?").get(imageId, s.organizationId);
    if (!img) throw new ProductInfoError("تصویر پیدا نشد", 404);
  }

  await db
    .prepare("UPDATE products SET category = ?, selling_points = ?, how_to_say = ?, image_id = ?, updated_at = ? WHERE id = ? AND organization_id = ?")
    .run(text(input.category, 40, "نام گروه"), lines.length ? lines.join("\n") : null, text(input.how_to_say, 200, "جملهٔ پیشنهادی"), imageId, new Date().toISOString(), productId, s.organizationId);
}
