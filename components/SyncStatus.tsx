"use client";

/** A small persistent indicator: online/offline, N pending, last synced. Tap to open the
 *  outbox -- each record readable, and still undoable while it is held. A queue the user
 *  cannot see is a queue they cannot trust (plan 4.5).
 *
 *  Browser code -- not unit-tested. Mounted once per app surface.
 */

import { useEffect, useState, useCallback } from "react";
import { getSyncEngine } from "@/lib/offline/syncEngine";
import { OFFLINE_OPS } from "@/lib/offline/safety";
import type { OutboxRecord } from "@/lib/offline/outbox";

function since(iso: string | null): string {
  if (!iso) return "هنوز همگام نشده";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "همین حالا";
  if (mins < 60) return `${mins} دقیقه پیش`;
  return `${Math.round(mins / 60)} ساعت پیش`;
}

export default function SyncStatus() {
  const [online, setOnline] = useState(true);
  const [records, setRecords] = useState<OutboxRecord[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const eng = getSyncEngine();
    setRecords(await eng.outbox.list());
    setLastSynced(eng.lastSyncedAt());
  }, []);

  useEffect(() => {
    const eng = getSyncEngine();
    eng.start();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    eng.addEventListener("change", refresh);
    void refresh();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      eng.removeEventListener("change", refresh);
    };
  }, [refresh]);

  const pending = records.filter(
    (r) => r.status === "held" || r.status === "pending" || r.status === "sending"
  ).length;
  const trouble = records.filter((r) => r.status === "failed" || r.status === "conflict").length;

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

  return (
    <div className="fixed bottom-3 left-3 z-40 text-[length:var(--text-xs)]" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 shadow-sm"
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: online ? "var(--good)" : "var(--text-faint)" }}
        />
        <span className="text-[var(--text-muted)]">
          {online ? "آنلاین" : "آفلاین"}
          {pending > 0 && ` · ${pending} در صف`}
          {trouble > 0 && ` · ${trouble} مشکل`}
        </span>
      </button>

      {open && (
        <div className="mt-2 max-h-[60vh] w-[min(20rem,90vw)] overflow-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <p className="m-0 mb-2 text-[var(--text-muted)]">آخرین همگام‌سازی: {since(lastSynced)}</p>
          {records.length === 0 && <p className="m-0 text-[var(--text-faint)]">صف خالی است</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {records.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="text-[var(--text)]">
                  {OFFLINE_OPS[r.op]?.label_fa ?? r.op}
                  <span className="block text-[var(--text-faint)]">
                    {r.status} · {new Date(r.occurred_at).toLocaleTimeString("fa-IR")}
                  </span>
                </span>
                {r.status === "held" && (
                  <button type="button" onClick={() => void undo(r.id)} className="text-[var(--accent)]">
                    لغو
                  </button>
                )}
                {(r.status === "failed" || r.status === "conflict") && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => void retry(r.id)} className="text-[var(--accent)]">
                      تلاش دوباره
                    </button>
                    <button type="button" onClick={() => void discard(r.id)} className="text-[var(--crit)]">
                      حذف
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
