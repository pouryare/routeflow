import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { mintTelegramNonce, clearTelegram } from "@/lib/repo/notifications";

const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

/** Mint a one-shot deep link the user opens to bind their telegram chat. The bot username
 *  is read from the environment at call time -- never inlined, and an unset one is a
 *  Persian 400 rather than a `https://t.me/undefined` link. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { user } = guard.session;

  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) {
    return NextResponse.json({ ok: false, error: "تلگرام پیکربندی نشده" }, { status: 400 });
  }
  const nonce = mintTelegramNonce(user.id);
  return NextResponse.json({ ok: true, url: `https://t.me/${bot}?start=${nonce}` });
}

/** Unbind: nulls both the chat id and any pending link nonce for the caller only. */
export async function DELETE(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  clearTelegram(guard.session.user.id);
  return NextResponse.json({ ok: true });
}
