/* The asset register (F140): the company's things and who holds them. A thing is retired, never deleted.
 * shortcut: no history of past holders, only the current one and the day they took it; add an audit trigger
 * (E6) when someone asks who had the van last month. */
import { getDb } from "@/lib/db";
import { isOwner } from "@/lib/roles";
import type { Session } from "@/lib/session";
import { tehranTodayIso } from "@/lib/jalali";

export class AssetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const ASSET_KIND_LABEL = { van: "ون", phone: "موبایل", tablet: "تبلت", printer: "پرینتر", scale: "ترازو", key: "کلید", other: "سایر" } as const;
const ASSET_CONDITION_LABEL = { good: "سالم", worn: "فرسوده", broken: "خراب" } as const;
type Kind = keyof typeof ASSET_KIND_LABEL;
type Condition = keyof typeof ASSET_CONDITION_LABEL;

export interface Asset {
  id: number;
  kind: Kind;
  name: string;
  serial: string | null;
  holder_user_id: number | null;
  holder_name: string | null;
  holder_since: string | null;
  condition: Condition;
}

function ownerOnly(s: Session) {
  if (!isOwner(s.role)) throw new AssetError("فقط مالک دارایی‌ها را مدیریت می‌کند", 403);
}

/** Things still in use, newest first. */
export async function listAssets(s: Session): Promise<Asset[]> {
  ownerOnly(s);
  return (await getDb()
    .prepare(
      `SELECT a.id, a.kind, a.name, a.serial, a.holder_user_id, u.display_name AS holder_name, a.holder_since, a.condition
         FROM assets a LEFT JOIN users u ON u.id = a.holder_user_id
        WHERE a.organization_id = ? AND a.retired_at IS NULL
        ORDER BY a.id DESC LIMIT 500`
    )
    .all(s.organizationId)) as unknown as Asset[];
}

export async function addAsset(s: Session, input: { kind: unknown; name: unknown; serial?: unknown }): Promise<void> {
  ownerOnly(s);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) throw new AssetError("نام را بنویسید (تا ۸۰ حرف)");
  if (typeof input.kind !== "string" || !(input.kind in ASSET_KIND_LABEL)) throw new AssetError("نوع را انتخاب کنید");
  const serial = typeof input.serial === "string" ? input.serial.trim().slice(0, 80) || null : null;
  await getDb()
    .prepare("INSERT INTO assets (organization_id, kind, name, serial, created_by, created_at) VALUES (?,?,?,?,?,?)")
    .run(s.organizationId, input.kind, name, serial, s.user.id, new Date().toISOString());
}

/** Gives it to someone (`holder`), takes it back to the shelf (`holder: null`), sets its condition or retires it. */
export async function updateAsset(s: Session, id: number, patch: { holder?: number | null; condition?: unknown; retire?: boolean }): Promise<void> {
  ownerOnly(s);
  const db = getDb();
  const a = (await db.prepare("SELECT id FROM assets WHERE id = ? AND organization_id = ? AND retired_at IS NULL").get(id, s.organizationId)) as { id: number } | undefined;
  if (!a) throw new AssetError("پیدا نشد", 404);
  if (patch.holder !== undefined) {
    if (patch.holder !== null) {
      const u = await db.prepare("SELECT id FROM users WHERE id = ? AND organization_id = ? AND active = 1").get(patch.holder, s.organizationId);
      if (!u) throw new AssetError("کاربر پیدا نشد", 404);
    }
    await db.prepare("UPDATE assets SET holder_user_id = ?, holder_since = ? WHERE id = ?").run(patch.holder, patch.holder === null ? null : tehranTodayIso(), id);
  }
  if (patch.condition !== undefined) {
    if (typeof patch.condition !== "string" || !(patch.condition in ASSET_CONDITION_LABEL)) throw new AssetError("وضعیت نامعتبر است");
    await db.prepare("UPDATE assets SET condition = ? WHERE id = ?").run(patch.condition, id);
  }
  if (patch.retire) await db.prepare("UPDATE assets SET retired_at = ?, holder_user_id = NULL, holder_since = NULL WHERE id = ?").run(new Date().toISOString(), id);
}
