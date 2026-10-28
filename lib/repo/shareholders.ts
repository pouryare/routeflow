/** Shareholders and their shares (company-and-shareholders, step 3).
 *
 *  A shareholder is a `parties` row of kind 'shareholder'. Shares are fixed agreed percentages, kept as
 *  basis points (6000 = 60%), each set carrying a start date; the set in force on a date is the latest
 *  one starting on or before it. A scope is the whole company (groupId null) or one group. A set must
 *  total exactly 100%: a split that does not add up would hand out more or less than the profit. */
import type { Db } from "@/lib/database/client";
import { LedgerError } from "./ledgerCore";

const FULL_BP = 10000;

export type LegalForm = "registered" | "unregistered";

export interface Shareholder {
  id: number;
  name: string;
  userId: number | null;
  active: boolean;
}

export interface ShareRow {
  partyId: number;
  percentBp: number;
}

export async function addShareholder(
  db: Db,
  input: { organizationId: number; name: string; userId?: number | null }
): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new LedgerError("نام شریک را بنویسید");
  if (input.userId != null) {
    const user = await db.prepare("SELECT organization_id FROM users WHERE id = ?").get(input.userId) as
      | { organization_id: number | null }
      | undefined;
    if (!user || user.organization_id !== input.organizationId) throw new LedgerError("این کاربر در این شرکت نیست");
    const taken = await db
      .prepare("SELECT id FROM parties WHERE organization_id = ? AND kind = 'shareholder' AND user_id = ?")
      .get(input.organizationId, input.userId);
    if (taken) throw new LedgerError("این کاربر قبلاً شریک ثبت شده است");
  }
  return Number(
    (await db
      .prepare(
        `INSERT INTO parties (organization_id, kind, user_id, name_fa, created_at)
         VALUES (?, 'shareholder', ?, ?, ?)`
      )
      .run(input.organizationId, input.userId ?? null, name, new Date().toISOString())).lastInsertRowid
  );
}

export async function listShareholders(db: Db, organizationId: number): Promise<Shareholder[]> {
  const rows = await db
    .prepare(
      `SELECT id, name_fa AS name, user_id AS "userId", active
         FROM parties WHERE organization_id = ? AND kind = 'shareholder' ORDER BY id`
    )
    .all(organizationId) as unknown as { id: number; name: string; userId: number | null; active: number }[];
  return rows.map((r) => ({ ...r, active: r.active === 1 }));
}

/** The shareholder record of a logged-in user in this company, if they are one. */
export async function shareholderOfUser(db: Db, organizationId: number, userId: number): Promise<Shareholder | null> {
  return (await listShareholders(db, organizationId)).find((s) => s.userId === userId) ?? null;
}

/** Record a full set of shares for a scope from a date. Replaces a set already recorded for the same date. */
export async function setShares(
  db: Db,
  input: { organizationId: number; groupId: number | null; validFrom: string; shares: ShareRow[]; createdBy: number }
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) throw new LedgerError("تاریخ شروع معتبر نیست");
  if (input.shares.length === 0) throw new LedgerError("حداقل یک شریک لازم است");
  const ids = new Set<number>();
  for (const s of input.shares) {
    if (!Number.isInteger(s.percentBp) || s.percentBp < 0 || s.percentBp > FULL_BP) {
      throw new LedgerError("سهم باید بین ۰ و ۱۰۰ درصد باشد");
    }
    if (ids.has(s.partyId)) throw new LedgerError("یک شریک دو بار آمده است");
    ids.add(s.partyId);
  }
  if (input.shares.reduce((t, s) => t + s.percentBp, 0) !== FULL_BP) {
    throw new LedgerError("جمع سهم‌ها باید دقیقاً ۱۰۰ درصد باشد");
  }
  const known = await listShareholders(db, input.organizationId);
  for (const id of ids) {
    if (!known.some((k) => k.id === id && k.active)) throw new LedgerError("شریک یافت نشد");
  }
  if (input.groupId != null) {
    const g = await db.prepare("SELECT 1 AS ok FROM groups WHERE id = ? AND organization_id = ?").get(input.groupId, input.organizationId);
    if (!g) throw new LedgerError("گروه یافت نشد");
  }

  const now = new Date().toISOString();
  await db.tx(async () => {
    await db
      .prepare(
        `DELETE FROM shareholdings
          WHERE organization_id = ? AND COALESCE(group_id, 0) = ? AND valid_from = ?`
      )
      .run(input.organizationId, input.groupId ?? 0, input.validFrom);
    const ins = db.prepare(
      `INSERT INTO shareholdings (organization_id, party_id, group_id, percent_bp, valid_from, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of input.shares) {
      await ins.run(input.organizationId, s.partyId, input.groupId, s.percentBp, input.validFrom, input.createdBy, now);
    }
  });
}

/** The set of shares in force on a date for a scope; empty when none has started. */
export async function sharesAt(db: Db, organizationId: number, groupId: number | null, onDate: string): Promise<ShareRow[]> {
  const start = await db
    .prepare(
      `SELECT MAX(valid_from) AS d FROM shareholdings
        WHERE organization_id = ? AND COALESCE(group_id, 0) = ? AND valid_from <= ?`
    )
    .get(organizationId, groupId ?? 0, onDate.slice(0, 10)) as { d: string | null };
  if (!start.d) return [];
  return await db
    .prepare(
      `SELECT party_id AS "partyId", percent_bp AS "percentBp" FROM shareholdings
        WHERE organization_id = ? AND COALESCE(group_id, 0) = ? AND valid_from = ? ORDER BY party_id`
    )
    .all(organizationId, groupId ?? 0, start.d) as unknown as ShareRow[];
}

export async function legalFormOf(db: Db, organizationId: number): Promise<LegalForm> {
  const row = await db.prepare("SELECT legal_form FROM organizations WHERE id = ?").get(organizationId) as
    | { legal_form: LegalForm }
    | undefined;
  return row?.legal_form ?? "unregistered";
}

export async function setLegalForm(db: Db, organizationId: number, form: LegalForm): Promise<void> {
  if (form !== "registered" && form !== "unregistered") throw new LedgerError("نوع شرکت معتبر نیست");
  await db.prepare("UPDATE organizations SET legal_form = ? WHERE id = ?").run(form, organizationId);
}
