"use client";

import ToggleSwitch from "@/components/ToggleSwitch";

import { useCallback, useMemo, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useToast } from "@/components/ToastProvider";
import { usePushSubscription } from "./usePushSubscription";
import CheckField from "@/components/CheckField";

type Channel = "push" | "telegram";

interface ChannelState {
  enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  critical_breaks_quiet: boolean;
  connected: boolean;
  configured: boolean;
}

interface MatrixRow {
  code: string;
  name_fa: string;
  category: string;
  default_push: number;
  default_telegram: number;
  push: boolean;
  telegram: boolean;
}

export interface PrefsMatrix {
  channels: Record<Channel, ChannelState>;
  types: MatrixRow[];
}

const CHANNEL_LABEL: Record<Channel, string> = { push: "اعلان مرورگر", telegram: "تلگرام" };

/** Catalogue categories, in the order the settings screen shows them. An unknown category
 *  falls back to its own code so a new catalogue row is never silently dropped. */
const CATEGORY_LABEL: Record<string, string> = {
  task: "کارها",
  order: "سفارش‌ها",
  delivery: "تحویل",
  finance: "مالی",
  customer: "مشتریان",
};
const CATEGORY_ORDER = ["task", "order", "delivery", "finance", "customer"];

export default function NotificationSettings({ initial }: { initial: PrefsMatrix }) {
  const [channels, setChannels] = useState(initial.channels);
  const [types, setTypes] = useState(initial.types);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const push = usePushSubscription();

  /** Every write goes through here: optimistic state is already applied by the caller, so
   *  a non-ok response hands back `false` and the caller reverts. The server's Persian
   *  message is surfaced verbatim — it is the one that knows *why*. */
  const send = useCallback(
    async (url: string, method: string, body: unknown): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) {
          toast(friendlyError(json?.error, "تنظیمات اعلان ذخیره نشد؛ دوباره تلاش کنید"), "error");
          return false;
        }
        return true;
      } catch {
        toast("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.", "error");
        return false;
      }
    },
    [toast]
  );

  const patchChannel = useCallback(
    async (channel: Channel, patch: Partial<ChannelState>) => {
      const before = channels[channel];
      setChannels((c) => ({ ...c, [channel]: { ...c[channel], ...patch } }));
      const ok = await send("/api/notifications/channels", "PUT", { channel, ...patch });
      if (!ok) setChannels((c) => ({ ...c, [channel]: before }));
    },
    [channels, send]
  );

  const togglePref = useCallback(
    async (code: string, channel: Channel, next: boolean) => {
      setTypes((rows) => rows.map((r) => (r.code === code ? { ...r, [channel]: next } : r)));
      const ok = await send("/api/notifications/prefs", "PUT", { type_code: code, channel, enabled: next });
      if (!ok) setTypes((rows) => rows.map((r) => (r.code === code ? { ...r, [channel]: !next } : r)));
    },
    [send]
  );

  async function connectTelegram() {
    setBusy("tg-connect");
    try {
      const res = await fetch("/api/notifications/telegram-link", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !json?.ok || !json.url) {
        toast(friendlyError(json?.error, "لینک اتصال تلگرام ساخته نشد؛ دوباره تلاش کنید"), "error");
        return;
      }
      // A new tab, not a redirect: the user comes back to a screen that still holds their
      // unsaved scroll position, and the bot confirms the link in telegram itself.
      window.open(json.url, "_blank", "noopener,noreferrer");
      toast("در تلگرام دکمهٔ «شروع» را بزنید، سپس این صفحه را تازه کنید.", "info");
    } finally {
      setBusy(null);
    }
  }

  async function disconnectTelegram() {
    setBusy("tg-disconnect");
    const ok = await send("/api/notifications/telegram-link", "DELETE", {});
    if (ok) {
      setChannels((c) => ({ ...c, telegram: { ...c.telegram, connected: false } }));
      toast("اتصال تلگرام قطع شد", "info");
    }
    setBusy(null);
  }

  async function connectPush() {
    setBusy("push-connect");
    const ok = await push.enable();
    if (ok) {
      setChannels((c) => ({ ...c, push: { ...c.push, connected: true } }));
      toast("این دستگاه متصل شد", "success");
    } else if (push.state === "denied") {
      toast("دسترسی اعلان مسدود شده — از تنظیمات مرورگر فعال کنید", "error");
    } else {
      toast("این دستگاه متصل نشد؛ دوباره تلاش کنید", "error");
    }
    setBusy(null);
  }

  async function disconnectPush() {
    setBusy("push-disconnect");
    const ok = await push.disable();
    if (ok) {
      setChannels((c) => ({ ...c, push: { ...c.push, connected: false } }));
      toast("اتصال این دستگاه قطع شد", "info");
    } else {
      toast("اتصال این دستگاه قطع نشد؛ دوباره تلاش کنید", "error");
    }
    setBusy(null);
  }

  async function sendTest(channel: Channel) {
    setBusy(`test-${channel}`);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        result?: { status?: string };
      } | null;
      if (!res.ok || !json?.ok) {
        toast(friendlyError(json?.error, "پیام آزمایشی ارسال نشد؛ دوباره تلاش کنید"), "error");
        return;
      }
      // `result` is the caller's OWN row, read back off its flush stamp — never the
      // org-wide counters, which would let a coworker's delivery read as a success here.
      if (json.result?.status === "sent") toast("پیام آزمایشی ارسال شد", "success");
      else if (json.result?.status === "held") toast("در ساعات سکوت نگه داشته شد", "info");
      else toast("پیام آزمایشی ارسال نشد؛ دوباره تلاش کنید", "error");
    } finally {
      setBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const by = new Map<string, MatrixRow[]>();
    for (const t of types) {
      const list = by.get(t.category);
      if (list) list.push(t);
      else by.set(t.category, [t]);
    }
    const known = CATEGORY_ORDER.filter((c) => by.has(c));
    const rest = [...by.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest].map((c) => [c, by.get(c) as MatrixRow[]] as const);
  }, [types]);

  return (
    <div dir="rtl" className="flex flex-col gap-5">
      {(["push", "telegram"] as const).map((ch) => {
        const s = channels[ch];
        const off = !s.configured;
        return (
          <section key={ch} className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="sechead__title">{CHANNEL_LABEL[ch]}</h2>
                <p className="mt-0.5 text-[length:var(--text-xs)] text-text-faint">
                  {off ? "در دسترس نیست" : s.connected ? "متصل" : "متصل نیست"}
                </p>
              </div>
              <ToggleSwitch
                on={s.enabled}
                disabled={off}
                label={`${CHANNEL_LABEL[ch]} — کلید اصلی`}
                onChange={() => patchChannel(ch, { enabled: !s.enabled })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-[length:var(--text-xs)] text-text-muted">شروع سکوت</span>
                <input
                  type="time"
                  defaultValue={s.quiet_start ?? ""}
                  disabled={off}
                  onBlur={(e) => {
                    const v = e.target.value || null;
                    if (v !== s.quiet_start) patchChannel(ch, { quiet_start: v });
                  }}
                  className="rounded-[var(--radius-md)] border border-border bg-surface px-2 py-1 text-[length:var(--text-sm)] text-text disabled:opacity-40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[length:var(--text-xs)] text-text-muted">پایان سکوت</span>
                <input
                  type="time"
                  defaultValue={s.quiet_end ?? ""}
                  disabled={off}
                  onBlur={(e) => {
                    const v = e.target.value || null;
                    if (v !== s.quiet_end) patchChannel(ch, { quiet_end: v });
                  }}
                  className="rounded-[var(--radius-md)] border border-border bg-surface px-2 py-1 text-[length:var(--text-sm)] text-text disabled:opacity-40"
                />
              </label>
              <CheckField
                checked={s.critical_breaks_quiet}
                disabled={off}
                onChange={() => patchChannel(ch, { critical_breaks_quiet: !s.critical_breaks_quiet })}
              >
                <span className="text-[length:var(--text-xs)] text-text-muted">
                  اجازه بده هشدارهای بحرانی ساعات سکوت را بشکنند
                </span>
              </CheckField>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {ch === "push" ? (
                push.state === "unsupported" ? (
                  <p className="text-[length:var(--text-xs)] text-text-faint">مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند.</p>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost"
                    disabled={off || busy !== null || push.state === "busy"}
                    onClick={push.state === "on" ? disconnectPush : connectPush}
                  >
                    <Icon name="link" size="md" />
                    {push.state === "on" ? "قطع اتصال این دستگاه" : "این دستگاه را متصل کن"}
                  </button>
                )
              ) : (
                <>
                  <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={off || busy !== null} onClick={connectTelegram}>
                    <Icon name="link" size="md" />
                    اتصال تلگرام
                  </button>
                  {s.connected && (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost"
                      disabled={busy !== null}
                      onClick={disconnectTelegram}
                    >
                      <Icon name="link" size="md" />
                      قطع اتصال
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost"
                disabled={off || !s.connected || busy !== null}
                onClick={() => sendTest(ch)}
              >
                <Icon name="check" size="md" />
                ارسال پیام آزمایشی
              </button>
            </div>
          </section>
        );
      })}

      <section className="card p-4">
        <h2 className="sechead__title mb-1">کدام اعلان‌ها بلند باشند</h2>
        <p className="mb-3 text-[length:var(--text-xs)] text-text-faint">
          خاموش‌کردن یک ردیف فقط جلوی اعلان بلند را می‌گیرد؛ همه‌چیز همچنان در زنگولهٔ بالای صفحه می‌آید.
        </p>

        {grouped.map(([category, rows]) => (
          <div key={category} className="mb-4 last:mb-0">
            <h3 className="sechead__title sechead__title--minor mb-2">
              {CATEGORY_LABEL[category] ?? category}
            </h3>
            <ul className="flex flex-col gap-1">
              {rows.map((t) => {
                const isDefault = t.push === (t.default_push === 1) && t.telegram === (t.default_telegram === 1);
                return (
                  <li
                    key={t.code}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-2 py-1.5 odd:bg-[color:var(--sunk)]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[length:var(--text-sm)] text-text">{t.name_fa}</span>
                      {isDefault && (
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[length:var(--text-xs)] text-text-faint">
                          پیش‌فرض
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-4">
                      {(["push", "telegram"] as const).map((ch) => (
                        <span key={ch} className="flex items-center gap-1.5">
                          <span className="text-[length:var(--text-xs)] text-text-faint">{CHANNEL_LABEL[ch]}</span>
                          <ToggleSwitch
                            on={t[ch]}
                            disabled={!channels[ch].configured}
                            label={`${t.name_fa} — ${CHANNEL_LABEL[ch]}`}
                            onChange={() => togglePref(t.code, ch, !t[ch])}
                          />
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
