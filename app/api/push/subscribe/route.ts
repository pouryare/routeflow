import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface SubscriptionBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SubscriptionBody | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "اشتراک نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(endpoint, p256dh, auth, new Date().toISOString());

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ ok: false, error: "اشتراک نامعتبر است" }, { status: 400 });
  }
  const db = getDb();
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(body.endpoint);
  return NextResponse.json({ ok: true });
}
