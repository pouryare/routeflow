/** Telegram Bot API send/edit wrappers. Plain `fetch`, no dependency. Every network- or
 *  HTTP-level failure is swallowed (`return null` / `false`) after one `console.warn`, so a
 *  dead bot never breaks a caller. `TELEGRAM_BOT_TOKEN` is read at call time (not module
 *  load) so tests can set/unset it. */

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

async function call(
  method: string,
  body: unknown
): Promise<{ ok: true; result: Record<string, unknown> } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
    if (!json?.ok || typeof json.result !== "object" || json.result === null) {
      console.warn(`[telegram] ${method} failed`, res.status, JSON.stringify(json).slice(0, 200));
      return null;
    }
    return json as { ok: true; result: Record<string, unknown> };
  } catch (e) {
    console.warn(`[telegram] ${method} threw`, e);
    return null;
  }
}

export async function sendTelegram(
  chatId: string,
  text: string
): Promise<{ message_id: number } | null> {
  const r = await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  return r ? { message_id: r.result.message_id as number } : null;
}

export async function editTelegram(
  chatId: string,
  messageId: number,
  text: string
): Promise<boolean> {
  const r = await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  });
  return !!r;
}
