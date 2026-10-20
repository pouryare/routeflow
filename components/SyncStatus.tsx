"use client";

/** A small persistent indicator: online/offline, N pending, last synced. Tap to open the
 *  outbox -- each record readable, and still undoable while it is held. A queue the user
 *  cannot see is a queue they cannot trust (plan 4.5).
 *
 *  Browser code -- not unit-tested. Mounted once per app surface.
 */

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Icon } from "@/components/meridian/Icon";
import { getSyncEngine } from "@/lib/offline/syncEngine";
import { OFFLINE_OPS } from "@/lib/offline/safety";
import { faNum } from "@/lib/format";
import type { OutboxRecord, OutboxStatus } from "@/lib/offline/outbox";

/** What each outbox state is called. The list printed the raw status («held»,
 *  «conflict») to Persian readers before this map. */
export const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = {
  held: "در انتظار ارسال، هنوز قابل لغو",
  pending: "در صف ارسال",
  sending: "در حال ارسال",
  applied: "ثبت شد",
  conflict: "ناسازگار با سرور",
  failed: "ناموفق",
};

/** Online, as the browser reports it. useSyncExternalStore rather than an effect that
 *  copies navigator.onLine into state: that effect set state on mount and was one of the
 *  app's suppressed lint errors. The server snapshot is "online", which is what the first
 *  client render must match. */
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** The outbox and the last sync time, kept current from the engine's change events.
 *  Shared by the floating indicator and the profile menu's sync row, so the two can never
 *  disagree. It does not start the engine; SyncStatus, mounted once per surface, does. */
export function useSyncState() {
  const online = useOnline();
  const [records, setRecords] = useState<OutboxRecord[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const eng = getSyncEngine();
    const [list, last] = [await eng.outbox.list(), eng.lastSyncedAt()];
    setRecords(list);
    setLastSynced(last);
  }, []);

  useEffect(() => {
    const eng = getSyncEngine();
    let alive = true;
    const onChange = () => {
      void eng.outbox.list().then((list) => {
        if (!alive) return;
        setRecords(list);
        setLastSynced(eng.lastSyncedAt());
      });
    };
    eng.addEventListener("change", onChange);
    onChange();
    return () => {
      alive = false;
      eng.removeEventListener("change", onChange);
    };
  }, []);

  const pending = records.filter((r) => r.status === "held" || r.status === "pending" || r.status === "sending").length;
  const trouble = records.filter((r) => r.status === "failed" || r.status === "conflict").length;
  return { online, records, lastSynced, pending, trouble, refresh };
}

export function since(iso: string | null): string {
  if (!iso) return "هنوز همگام نشده";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "همین حالا";
  if (mins < 60) return `${mins} دقیقه پیش`;
  return `${Math.round(mins / 60)} ساعت پیش`;
}

/** What the indicator should say, or null for "say nothing".
 *
 *  Ranked, because these overlap. Offline is the most actionable and hides the rest —
 *  nothing drains while there is no connection, so a queue length underneath it is noise.
 *  Then failures, which need a decision. Then a queue that is merely waiting.
 *
 *  Returning null for "online, nothing queued" is the point: that is the state the app is
 *  in almost all the time, and a badge that is always lit is a badge nobody reads. It used
 *  to print «آنلاین» permanently.
 *
 *  Pure, so the ranking is testable — the component around it is browser glue and is not
 *  unit-tested, per repo convention.
 */
export function syncBadge(s: {
  online: boolean;
  pending: number;
  trouble: number;
}): { tone: "crit" | "warn" | "muted"; label: string } | null {
  if (!s.online) return { tone: "muted", label: "آفلاین" };
  if (s.trouble > 0) return { tone: "crit", label: `${faNum(s.trouble)} مشکل در همگام‌سازی` };
  if (s.pending > 0) return { tone: "warn", label: `${faNum(s.pending)} در صف` };
  return null;
}

export default function SyncStatus() {
  const { online, records, lastSynced, pending, trouble, refresh } = useSyncState();
  const [open, setOpen] = useState(false);

  /* This component owns the engine's lifetime: mounted once per surface. */
  useEffect(() => {
    getSyncEngine().start();
  }, []);

  const badge = syncBadge({ online, pending, trouble });

  async function undo(id: string) {
    await getSyncEngine().outbox.undo(id);
    await refresh();
  }
  async function retry(id: string) {
    const eng = getSyncEngine();
    const r = await eng.store.get(id);
    if (r) {
      await eng.store.put({ ...r, status: "pending", retry_after: 0 });
      void eng.runCycle();
    }
  }
  async function discard(id: string) {
    await getSyncEngine().store.remove(id);
    await refresh();
  }

  /* Nothing worth reporting: online, nothing queued, nothing failed. The outbox is still
     reachable from /settings; this island is only for states that need a person. */
  if (!badge) return null;

  return (
    <div className="fixed bottom-3 left-3 z-40 text-[length:var(--text-xs)]" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 shadow-sm"
      >
        <Icon name="undo" size="md" />
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: `var(--${badge.tone === "muted" ? "text-faint" : badge.tone})` }}
        />
        <span className="text-[var(--text-muted)]">{badge.label}</span>
      </button>

      {open && (
        <div className="mt-2 max-h-[60vh] w-[min(20rem,90vw)] overflow-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <p className="m-0 mb-2 text-[var(--text-muted)]">آخرین همگام‌سازی: {since(lastSynced)}</p>
          {records.length === 0 && <p className="m-0 text-[var(--text-faint)]">صف خالی است</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {records.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="text-[var(--text)]">
                  {OFFLINE_OPS[r.op]?.label_fa ?? "عملیات"}
                  <span className="block text-[var(--text-faint)]">
                    {OUTBOX_STATUS_LABEL[r.status] ?? "نامشخص"} · {new Date(r.occurred_at).toLocaleTimeString("fa-IR")}
                  </span>
                </span>
                {r.status === "held" && (
                  <button type="button" onClick={() => void undo(r.id)} className="text-[var(--accent)]">
                    <Icon name="x" size="md" />
                    بازگردانی ثبت
                  </button>
                )}
                {(r.status === "failed" || r.status === "conflict") && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => void retry(r.id)} className="text-[var(--accent)]">
                      <Icon name="undo" size="md" />
                      ارسال دوباره
                    </button>
                    <button type="button" onClick={() => void discard(r.id)} className="text-[var(--crit)]">
                      <Icon name="trash" size="md" />
                      حذف این ثبت
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
