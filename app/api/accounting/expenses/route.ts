import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { recordExpense, expenseCategories, LedgerError } from "@/lib/repo/ledgerPostings";
import { OWNER_ROLES, type Role } from "@/lib/roles";

/* Owners plus group_manager. The user approved this on 2026-10-02: rent and fuel are real
   daily costs, and an owner should not have to type every line. The risk is a manager
   inventing expenses to flatter their group's result, so accountability is `created_by` on
   the journal plus the expense report showing who entered what -- attribution, not a second
   set of books. OWNER_ROLES is a CONSTANT, never a literal ["owner"]: platform_owner is a
   strict superset of owner (lib/roles.ts:46) and naming the literal is the exact bug that
   constant exists to prevent.

   phone_sales is deliberately absent: they record what customers pay, not what the business
   spends. */
const ROLES: Role[] = [...OWNER_ROLES, "group_manager"];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, categories: expenseCategories() });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    account_id?: number;
    amount_toman?: number;
    method?: string;
    incurred_at?: string;
    memo?: string | null;
  } | null;

  if (
    !body?.account_id ||
    !Number.isInteger(body.amount_toman) ||
    (body.amount_toman as number) <= 0 ||
    !body.method ||
    !body.incurred_at
  ) {
    return NextResponse.json({ ok: false, error: "اطلاعات هزینه ناقص است" }, { status: 400 });
  }

  /* No BEGIN here on purpose: tests/repo-boundary.test.ts fails the build for raw SQL
     outside lib/repo/, so the transaction lives in recordExpense. */
  try {
    const id = recordExpense({
      organizationId: guard.session.organizationId,
      accountId: Number(body.account_id),
      amountToman: body.amount_toman as number,
      method: body.method,
      incurredAt: body.incurred_at,
      incurredBy: guard.session.user.id,
      memo: body.memo ?? null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    // A refusal the user can act on -- wrong category, closed period, a CREDIT_NOTE method.
    // Anything else is a bug and rethrows rather than becoming a 409.
    if (e instanceof LedgerError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
