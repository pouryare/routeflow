/* Z2: no double save. A money form sends an `Idempotency-Key` header (one per form opening). The first request
 * with a key runs and its answer is kept; a repeat gets that answer and saves nothing. A repeat that arrives while
 * the first is still running gets 409. A failed first try (status >= 400) forgets the key so the user can fix and
 * resend. No header means no protection, so old clients keep working.
 * shortcut: keys are kept for ever; FB41 retention purges them after 7 days. */
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";

const KEY = /^[A-Za-z0-9_-]{8,80}$/;

export async function once(req: NextRequest, run: () => Promise<NextResponse>): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key");
  if (!key || !KEY.test(key)) return await run();
  const s = await getSession(req);
  if (!s) return await run();
  const db = getDb();
  const claimed = await db
    .prepare(
      `INSERT INTO idempotency_keys (organization_id, key, user_id, path, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, key) DO NOTHING`
    )
    .run(s.organizationId, key, s.user.id, req.nextUrl.pathname, new Date().toISOString());
  if (!claimed.changes) {
    const prior = (await db
      .prepare("SELECT status, response_json FROM idempotency_keys WHERE organization_id = ? AND key = ?")
      .get(s.organizationId, key)) as { status: number | null; response_json: string | null } | undefined;
    if (prior?.status != null && prior.response_json != null) {
      return new NextResponse(prior.response_json, { status: prior.status, headers: { "Content-Type": "application/json", "Idempotent-Replay": "1" } });
    }
    return NextResponse.json({ ok: false, error: "ثبت قبلی هنوز در حال انجام است؛ چند لحظه صبر کنید" }, { status: 409 });
  }
  const forget = async () => {
    await db.prepare("DELETE FROM idempotency_keys WHERE organization_id = ? AND key = ?").run(s.organizationId, key);
  };
  let res: NextResponse;
  try {
    res = await run();
  } catch (e) {
    await forget();
    throw e;
  }
  if (res.status >= 400) {
    await forget();
    return res;
  }
  await db
    .prepare("UPDATE idempotency_keys SET status = ?, response_json = ? WHERE organization_id = ? AND key = ?")
    .run(res.status, await res.clone().text(), s.organizationId, key);
  return res;
}
