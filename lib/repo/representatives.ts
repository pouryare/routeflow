import { makeRepo } from "./base";
import { canAdvance, type RepStage } from "@/lib/repStages";
import { ONBOARDING_STEPS } from "@/lib/repOnboarding";

export class RepStageError extends Error {}

export interface RepRow {
  id: number;
  organization_id: number;
  customer_id: number;
  rep_code: string;
  manager_user_id: number | null;
  stage: RepStage;
  activated_at: string | null;
  first_order_at: string | null;
  credit_terms_days: number;
  created_at: string;
  updated_at: string;
}

export interface OnboardingStepRow {
  id: number;
  representative_id: number;
  step_code: string;
  label_fa: string;
  required: number;
  sort_order: number;
  completed_at: string | null;
  completed_by: number | null;
  notes: string | null;
}

export const repsRepo = makeRepo<RepRow>("representative_profiles", { tenant: true });

export interface RepWithCustomer extends RepRow {
  business_name: string;
  customer_code: string;
}

/** Organisation-scoped WHOLESALE customers not already linked to a representative --
 *  the pick list for the "add representative" form. */
export function listWholesaleCandidates(
  organizationId: number
): { id: number; business_name: string; customer_code: string }[] {
  return repsRepo
    .db()
    .prepare(
      `SELECT c.id, c.business_name, c.customer_code
         FROM customers c
        WHERE c.organization_id = ?
          AND c.customer_type = 'WHOLESALE'
          AND c.id NOT IN (SELECT customer_id FROM representative_profiles WHERE organization_id = ?)
        ORDER BY c.business_name`
    )
    .all(organizationId, organizationId) as unknown as {
    id: number;
    business_name: string;
    customer_code: string;
  }[];
}

/** Every representative in the organisation, newest first, with the linked customer's
 *  name and code joined in for the admin list. */
export function listWithCustomer(organizationId: number): RepWithCustomer[] {
  return repsRepo
    .db()
    .prepare(
      `SELECT r.*, c.business_name, c.customer_code
         FROM representative_profiles r
         JOIN customers c ON c.id = r.customer_id
        WHERE r.organization_id = ?
        ORDER BY r.created_at DESC`
    )
    .all(organizationId) as unknown as RepWithCustomer[];
}

/** Creates the profile and seeds the standard onboarding checklist in one transaction. */
export function createRepresentative(
  organizationId: number,
  input: { customer_id: number; rep_code: string; manager_user_id: number | null }
): number {
  const db = repsRepo.db();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const repId = Number(
      db
        .prepare(
          `INSERT INTO representative_profiles
             (organization_id, customer_id, rep_code, manager_user_id, stage, credit_terms_days, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'prospect', 0, ?, ?)`
        )
        .run(organizationId, input.customer_id, input.rep_code, input.manager_user_id, now, now)
        .lastInsertRowid
    );
    const step = db.prepare(
      `INSERT INTO representative_onboarding_steps (representative_id, step_code, label_fa, required, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const s of ONBOARDING_STEPS) step.run(repId, s.step_code, s.label_fa, s.required ? 1 : 0, s.sort_order);
    db.exec("COMMIT");
    return repId;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listOnboarding(organizationId: number, repId: number): OnboardingStepRow[] {
  if (!repsRepo.get(organizationId, repId)) throw new RepStageError("نماینده پیدا نشد");
  return repsRepo
    .db()
    .prepare(
      "SELECT * FROM representative_onboarding_steps WHERE representative_id = ? ORDER BY sort_order"
    )
    .all(repId) as unknown as OnboardingStepRow[];
}

export function completeStep(
  organizationId: number,
  repId: number,
  stepCode: string,
  userId: number
): void {
  if (!repsRepo.get(organizationId, repId)) throw new RepStageError("نماینده پیدا نشد");
  repsRepo
    .db()
    .prepare(
      "UPDATE representative_onboarding_steps SET completed_at = ?, completed_by = ? WHERE representative_id = ? AND step_code = ?"
    )
    .run(new Date().toISOString(), userId, repId, stepCode);
}

export function advanceStage(organizationId: number, repId: number, to: RepStage): void {
  const rep = repsRepo.get(organizationId, repId);
  if (!rep) throw new RepStageError("نماینده پیدا نشد");
  if (!canAdvance(rep.stage, to)) {
    throw new RepStageError(`گذار از «${rep.stage}» به «${to}» مجاز نیست`);
  }
  if (to === "active") {
    const pending = repsRepo
      .db()
      .prepare(
        "SELECT COUNT(*) n FROM representative_onboarding_steps WHERE representative_id = ? AND required = 1 AND completed_at IS NULL"
      )
      .get(repId) as { n: number };
    if (pending.n > 0) throw new RepStageError(`${pending.n} مرحلهٔ پذیرش هنوز کامل نشده است`);
  }
  const patch: Partial<RepRow> = { stage: to, updated_at: new Date().toISOString() };
  if (to === "active" && !rep.activated_at) patch.activated_at = new Date().toISOString();
  repsRepo.patch(organizationId, repId, patch);
}
