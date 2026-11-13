"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { onLive, onLiveOpen } from "@/lib/live/client";
import { faJalaliDateTime } from "@/lib/jalali";
import { friendlyError } from "@/lib/userMessage";
import { MAX_CHAT_CHARS, type ChatMessage, type ChatRecord } from "@/lib/chat";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";
const newKey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

/** FB9 phase 1: the chat thread on an order or a customer. A button with the unread count opens a sheet; new messages arrive live. */
export default function RecordChat({ type, id, name }: { type: ChatRecord; id: number; name: string }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [me, setMe] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const url = `/api/chat/${type}/${id}`;

  const countUnread = useCallback(async () => {
    const res = await fetch(`${url}?unread=1`).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { unread?: number } | null;
    if (res?.ok && typeof j?.unread === "number") setUnread(j.unread);
  }, [url]);

  /** The newest messages (all of the latest page on open, the new ones after that). */
  const load = useCallback(async () => {
    const res = await fetch(lastId.current ? `${url}?after=${lastId.current}` : url).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { messages?: ChatMessage[]; me?: number } | null;
    if (!res?.ok || !j?.messages) return;
    if (typeof j.me === "number") setMe(j.me);
    const fresh = j.messages;
    if (fresh.length === 0) return;
    lastId.current = fresh[fresh.length - 1].id;
    setMessages((cur) => (cur.length && fresh[0].id <= cur[cur.length - 1].id ? cur : [...cur, ...fresh]));
    setUnread(0);
  }, [url]);

  // The unread count, kept fresh while the sheet is closed.
  useEffect(() => {
    const first = setTimeout(() => void countUnread(), 0);
    const off = onLive("chat.msg", (d) => {
      const m = d as { t?: string; r?: number } | null;
      if (m?.t === type && m.r === id) void (open ? load() : countUnread());
    });
    const offOpen = onLiveOpen(() => void (open ? load() : countUnread()));
    return () => { clearTimeout(first); off(); offOpen(); };
  }, [type, id, open, load, countUnread]);

  useEffect(() => {
    if (!open) return;
    lastId.current = 0;
    const t = setTimeout(() => { setMessages([]); void load(); }, 0);
    return () => clearTimeout(t);
  }, [open, load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text, clientKey: newKey() }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { setText(""); void load(); } else setError(friendlyError(j?.error, "ارسال نشد؛ اتصال را بررسی و دوباره تلاش کنید"));
  }

  return (
    <>
      <button type="button" className={BTN} data-tour={`${type}:chat`} onClick={() => setOpen(true)}>
        <Icon name="message-circle" size="md" />
        گفتگو
        {unread > 0 ? <span className="rounded-full bg-[var(--accent)] px-[var(--space-2)] text-[length:var(--text-xs)] text-accent-ink" aria-label={`${unread.toLocaleString("fa-IR")} پیام نخوانده`}>{unread.toLocaleString("fa-IR")}</span> : null}
      </button>
      {open ? (
        <BottomSheet open title="گفتگو" subtitle={name} onClose={() => setOpen(false)} closeLabel="بستن گفتگو" live>
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">هر کسی که این صفحه را می‌بیند، این گفتگو را هم می‌بیند. مدیر می‌تواند همهٔ گفتگوها را بخواند.</p>
            <div ref={listRef} className="flex max-h-[45vh] flex-col gap-[var(--space-2)] overflow-y-auto" aria-live="polite">
              {messages.length === 0 ? <p className="m-0 py-[var(--space-4)] text-center text-[length:var(--text-sm)] text-[var(--muted)]">هنوز پیامی نیست. اولین پیام را بنویسید.</p> : null}
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[85%] rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] ${m.authorId === me ? "self-start bg-[var(--accent)] text-accent-ink" : "self-end border border-[var(--border)]"}`}>
                  <div className="text-[length:var(--text-xs)] opacity-80">{m.author} · <bdi dir="ltr">{faJalaliDateTime(m.at).replace(" ", " \u00B7 ")}</bdi></div>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                </div>
              ))}
            </div>
            {error ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <form className="flex items-center gap-[var(--space-2)]" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) void send(); }}>
              <div className="min-w-0 flex-1"><FieldInput value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_CHAT_CHARS} placeholder="پیام" aria-label="متن پیام" /></div>
              <button type="submit" disabled={busy || !text.trim()} className={`${BTN} bg-[var(--accent)] text-accent-ink`} aria-label="ارسال پیام">
                <Icon name="send" size="md" />
                ارسال
              </button>
            </form>
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}
