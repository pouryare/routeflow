import { makeRepo } from "./base";

export class ReasonCodeError extends Error {}

export type ReasonDomain =
  | "delivery_fail"
  | "delivery_delay"
  | "order_cancel"
  | "order_return";

export interface ReasonCodeRow {
  id: number;
  organization_id: number | null;
  domain: ReasonDomain;
  code: string;
  label_fa: string;
  active: number;
  created_at: string;
}

/** Tenant repo for a tenant's OWN reason codes. The system defaults
 *  (organization_id NULL) are read through `listReasonCodes`, which unions both. */
export const reasonCodesRepo = makeRepo<ReasonCodeRow>("reason_codes", { tenant: true });

/** Active reason codes visible to a tenant: its own rows plus the system defaults
 *  (organization_id NULL). Optionally filtered to one domain. Ordered system-first so a
 *  picker shows the common cases before a tenant's bespoke ones. */
export function listReasonCodes(
  organizationId: number,
  domain?: ReasonDomain
): ReasonCodeRow[] {
  const params: unknown[] = [organizationId];
  let sql = `SELECT * FROM reason_codes
              WHERE active = 1 AND (organization_id = ? OR organization_id IS NULL)`;
  if (domain) {
    sql += " AND domain = ?";
    params.push(domain);
  }
  sql += " ORDER BY (organization_id IS NOT NULL), domain, code";
  return reasonCodesRepo.db().prepare(sql).all(...(params as never[])) as ReasonCodeRow[];
}

/** Add a reason code for one tenant. Refuses a domain the schema does not know, and a
 *  code that already exists for this tenant in this domain. */
export function createReasonCode(
  organizationId: number,
  input: { domain: ReasonDomain; code: string; label_fa: string }
): number {
  const code = input.code.trim();
  const label = input.label_fa.trim();
  if (!code || !label) throw new ReasonCodeError("کد و برچسب لازم است");
  const clash = reasonCodesRepo
    .db()
    .prepare(
      "SELECT 1 FROM reason_codes WHERE organization_id = ? AND domain = ? AND code = ?"
    )
    .get(organizationId, input.domain, code);
  if (clash) throw new ReasonCodeError("این کد قبلاً برای این دسته ثبت شده است");
  try {
    return reasonCodesRepo.insert(organizationId, {
      organization_id: organizationId,
      domain: input.domain,
      code,
      label_fa: label,
      active: 1,
      created_at: new Date().toISOString(),
    } as Omit<ReasonCodeRow, "id">);
  } catch (e) {
    if (e instanceof Error && /CHECK constraint/.test(e.message)) {
      throw new ReasonCodeError("دستهٔ نامعتبر");
    }
    throw e;
  }
}

/** Hide a tenant's own reason code. A system default cannot be deactivated by a tenant. */
export function deactivateReasonCode(organizationId: number, id: number): void {
  const row = reasonCodesRepo.get(organizationId, id);
  if (!row) throw new ReasonCodeError("کد پیدا نشد");
  reasonCodesRepo.patch(organizationId, id, { active: 0 } as Partial<ReasonCodeRow>);
}
