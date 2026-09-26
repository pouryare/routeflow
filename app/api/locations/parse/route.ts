import { NextRequest, NextResponse } from "next/server";
import { parsePastedChat } from "@/lib/pasteImport";
import { requireRole } from "@/lib/session";
import * as importRepo from "@/lib/repo/leadImport";
import { startJob } from "@/lib/leadImport/runner";

/** POST: turn a pasted chat export or list of maps links into a decode job.
 *
 *  Returns as soon as the links are parsed -- no network calls happen in here. The
 *  decode runs detached (lib/leadImport/runner.ts) and the panel polls
 *  /api/locations/parse/[jobId] for progress, because a thousand links cannot be
 *  resolved inside one request's lifetime. This route used to do the whole decode
 *  inline and hand back one array at the end, which is what timed out on a large paste.
 */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const text = (body as { text?: string } | null)?.text;
  if (!text || !text.trim()) {
    return NextResponse.json({ ok: false, error: "متنی برای تجزیه وارد نشده است" }, { status: 400 });
  }

  // Parsing is pure string work: pairing names with links, dropping repeats. No
  // coordinates are fetched yet, which is what keeps this fast enough to answer at once.
  const items = parsePastedChat(text);
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "هیچ لینک نقشه‌ای در متن پیدا نشد" }, { status: 422 });
  }

  const jobId = importRepo.createJob(
    guard.session.organizationId,
    guard.session.groupId,
    items.length
  );
  importRepo.addItems(guard.session.organizationId, jobId, items);

  // Deliberately not awaited: the response goes out now while the runner fills the
  // rows in behind it. A second paste while one runs is left queued, not dropped.
  startJob(guard.session.organizationId, jobId);

  return NextResponse.json({
    ok: true,
    jobId,
    total: items.length,
    // The parsed items travel with the response so the panel can draw its rows as
    // placeholders immediately. Nothing here is decoded yet -- these are the names and
    // links the paste contained, in paste order, which is all the first paint needs.
    items: importRepo.listItems(guard.session.organizationId, jobId).map((i) => ({
      id: i.id,
      ordinal: i.ordinal,
      name: i.name,
      address: i.address,
      lat: i.lat,
      lng: i.lng,
      resolution: i.resolution,
      status: i.status,
      duplicate_name: i.duplicate_name,
    })),
  });
}
