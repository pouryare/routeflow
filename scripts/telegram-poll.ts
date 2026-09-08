#!/usr/bin/env node --experimental-strip-types
// Long-polls the Telegram Bot API and redeems «/start <nonce>» deep links, binding a
// telegram chat to the کارگاه user who minted that nonce. Run standalone by systemd,
// mirroring scripts/run-sweeps.mjs conventions: config comes from process.env the way
// systemd's EnvironmentFile= injects it.
//
//   node --experimental-strip-types scripts/telegram-poll.ts
//
// This is a WORKER, not a webhook: no inbound port, no TLS certificate, no public URL, so
// it works unchanged behind the same NAT as the rest of the deployment.
//
// The unit is Restart=always because getUpdates is a 50-second blocking call — a clean
// exit is not expected, and a crash should simply resume from the persisted offset:
//
//   # /etc/systemd/system/routeflow-telegram.service   (NOT installed by this script)
//   [Unit]
//   Description=RouteFlow telegram link worker
//   After=network-online.target
//   [Service]
//   Type=simple
//   WorkingDirectory=/root/pourya/RouteFlow
//   EnvironmentFile=/root/pourya/RouteFlow/.env.local
//   ExecStart=/usr/bin/node --experimental-strip-types scripts/telegram-poll.ts
//   Restart=always
//   RestartSec=5
//   [Install]
//   WantedBy=multi-user.target
//
// It imports lib/repo/telegramLink.ts and nothing else: that module's only import is a
// TYPE import, which --experimental-strip-types erases, so there is no bundler, no `@/`
// alias, and no second copy of the linking logic to keep in sync.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { consumeTelegramStart } from "../lib/repo/telegramLink.ts";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Same resolution as lib/db.ts, so the worker and the app always open the same file.
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(process.cwd(), "data", "routeflow.db");
const OFFSET_PATH = `${DB_PATH}.telegram-offset`;

const LINKED_REPLY = "حساب تلگرام شما به کارگاه متصل شد.";
// Anything that is not a valid deep link gets this instead of silence, so a user who
// types «سلام» at the bot learns where the button is rather than assuming it is broken.
const HELP_REPLY = "برای اتصال، از «تنظیمات ← اعلان‌ها» در کارگاه دکمهٔ اتصال تلگرام را بزنید.";

// A missing token is a deployment that has not configured telegram yet, not a fault.
// Exit 0 so systemd's Restart=always does not hot-loop on a machine that will never have one.
if (!TOKEN) {
  console.log("[telegram] TELEGRAM_BOT_TOKEN is not set — telegram is not configured, exiting");
  process.exit(0);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

/** Telegram puts the bot token in the URL PATH, so a raw URL must never reach a log line
 *  or an error message. Every log below goes through this. */
function redact(s: string): string {
  return s.split(TOKEN as string).join("<token>");
}

function readOffset(): number {
  try {
    const n = Number.parseInt(fs.readFileSync(OFFSET_PATH, "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    // Missing on a first run, unreadable or corrupt after a bad shutdown — either way,
    // starting from 0 replays at most the 24h getUpdates backlog, and redeeming a burnt
    // nonce is already a no-op.
    return 0;
  }
}

function writeOffset(n: number): void {
  try {
    fs.writeFileSync(OFFSET_PATH, String(n));
  } catch (err) {
    console.warn(`[telegram] could not persist offset: ${redact((err as Error).message)}`);
  }
}

async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
  if (!json?.ok) throw new Error(`${method} failed (${res.status}): ${json?.description ?? "unknown"}`);
  return json.result;
}

function reply(chatId: number | string, text: string): void {
  // Best-effort: a failed courtesy reply must never stall the loop or lose the offset.
  void call("sendMessage", { chat_id: chatId, text }).catch((err) =>
    console.warn(`[telegram] sendMessage failed: ${redact((err as Error).message)}`)
  );
}

interface Update {
  update_id: number;
  message?: { text?: string; chat?: { id?: number } };
}

const db = new DatabaseSync(DB_PATH);
let offset = readOffset();
console.log(`[telegram] worker up, db=${DB_PATH}, offset=${offset}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

while (true) {
  try {
    const updates = (await call("getUpdates", { offset, timeout: 50 })) as Update[];
    for (const u of updates) {
      // Acknowledge first: getUpdates re-delivers anything below `offset`, so a message
      // that makes us throw would otherwise be retried forever.
      offset = Math.max(offset, u.update_id + 1);
      const text = u.message?.text;
      const chatId = u.message?.chat?.id;
      if (!text || chatId == null) continue;
      const r = consumeTelegramStart(db, text, String(chatId));
      if (r.linked) {
        console.log(`[telegram] linked chat ${chatId} to user ${r.userId}`);
        reply(chatId, LINKED_REPLY);
      } else {
        reply(chatId, HELP_REPLY);
      }
    }
    if (updates.length) writeOffset(offset);
  } catch (err) {
    // Network blip, 429, or a Telegram outage. Sleep so a hard failure cannot spin the CPU.
    console.warn(`[telegram] poll failed: ${redact((err as Error).message)}`);
    await sleep(2000);
  }
}
