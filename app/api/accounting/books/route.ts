import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { ACCOUNTING_ROLES } from "@/lib/roles";
import { BOOKS_DOCS, booksFor, type BooksDoc } from "@/lib/repo/documentBooks";

/** B3: the debit and credit lines behind one order, payment, cheque or expense. Owner only, the
 *  same people the ledger pages these lines link to let in. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, ACCOUNTING_ROLES);
  if (!guard.ok) return guard.response;
  const doc = req.nextUrl.searchParams.get("doc") ?? "";
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!BOOKS_DOCS.includes(doc as BooksDoc) || !isId(id)) {
    return NextResponse.json({ ok: false, error: "سند معتبر نیست" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, journals: await booksFor(guard.session.organizationId, doc as BooksDoc, Number(id)) });
}
