"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { getSyncEngine } from "@/lib/offline/syncEngine";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** Z19 «به‌روزرسانی داده‌ها»: start the phone's copy of the data over. Refused while anything is still
 *  waiting to be sent, because clearing it then would lose work; it offers to send first. */
export default function SafeRefresh() {
  const [msg, setMsg] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    const r = await getSyncEngine().clearLocalCopy();
    if (r.ok) {
      window.location.reload();
      return;
    }
    setBusy(false);
    setBlocked(true);
    setMsg(`${faNum(r.unsent)} مورد هنوز به سرور نرسیده است. اول همگام کنید؛ پاک کردن الان آن‌ها را از بین می‌برد.`);
  }

  async function syncNow() {
    setBusy(true);
    await getSyncEngine().runCycle().catch(() => {});
    setBusy(false);
    setBlocked(false);
    setMsg("همگام‌سازی انجام شد؛ دوباره «به‌روزرسانی داده‌ها» را بزنید.");
  }

  return (
    <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]">
      <h2 className="sechead__title">داده‌های این گوشی</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        اگر چیزی در این گوشی قدیمی یا ناقص به نظر می‌رسد، نسخهٔ این گوشی را پاک کنید تا از نو گرفته شود.
      </p>
      {msg ? <p className="m-0 text-[length:var(--text-sm)]" role="status">{msg}</p> : null}
      {blocked ? (
        <button type="button" className={BTN} disabled={busy} onClick={() => void syncNow()}>
          <Icon name="upload" size="md" />
          همگام‌سازی همین حالا
        </button>
      ) : (
        <button type="button" className={BTN} disabled={busy} onClick={() => void refresh()}>
          <Icon name="refresh" size="md" />
          به‌روزرسانی داده‌ها
        </button>
      )}
    </section>
  );
}
