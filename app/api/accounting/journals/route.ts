import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ACCOUNTING_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { postManualJournal, reverseManualJournal } from "@/lib/repo/manualJournal";

/** H3: { action: "post", debit, credit, amount, memo } posts a manual سند; { action: "reverse", id, reason } cancels one.
 *  The owner and the accountant only (proxy.ts admits the accountant to this prefix). */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ACCOUNTING_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const org = guard.session.organizationId;
  const by = guard.session.user.id;
  try {
    if (b?.action === "post") {
      const id = await postManualJournal(org, by, {
        debitAccountId: Number(b.debit), creditAccountId: Number(b.credit), amountToman: Number(b.amount),
        memo: typeof b.memo === "string" ? b.memo : "",
      });
      return NextResponse.json({ ok: true, id });
    }
    if (b?.action === "reverse") {
      const id = await reverseManualJournal(org, Number(b.id), by, typeof b.reason === "string" ? b.reason : "");
      return NextResponse.json({ ok: true, id });
    }
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
}
