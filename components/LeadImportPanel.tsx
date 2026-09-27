"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./ToastProvider";
import { faNum } from "@/lib/format";
import DecodeConsole, { type JobSnapshot } from "./leadImport/DecodeConsole";
import type { LiveItem } from "./leadImport/LiveItemList";

/** How often the running job is re-read. Once a second is fast enough that the list
 *  looks continuous and slow enough to be invisible next to the decoding itself. */
const POLL_MS = 1000;

interface Snapshot {
  job: JobSnapshot;
  items: LiveItem[];
  currentMethod: string | null;
  remaining: Record<string, number>;
  etaSeconds: number;
}

/** «افزودن از لینک» — paste a chat export or a list of maps links.
 *
 *  This used to post the whole paste and block until every link had been decoded, then
 *  hand back a finished list to review. On anything larger than a screenful of links
 *  that request simply timed out. Now it creates a job, walks away, and watches it
 *  arrive: clean results save themselves, and only what needs a decision is left on
 *  screen at the end. */
export default function LeadImportPanel({ onAdded }: { onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const toast = useToast();
  const notified = useRef(false);

  const parse = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/locations/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "خطا در تجزیه متن", "error");
        return;
      }
      // The job exists now. Adopt it immediately rather than waiting for the next poll:
      // setting the snapshot to null here (the earlier version) left the panel sitting on
      // the paste box after a *successful* start, so a user who pasted a hundred links
      // saw no progress at all until they refreshed the page by hand.
      notified.current = false;
      setText("");
      setSnapshot({
        job: {
          id: data.jobId,
          status: "running",
          total: data.total ?? 0,
          done_count: 0,
          unresolved_count: 0,
          duplicate_count: 0,
          added_count: 0,
        },
        // The pasted items are known before anything is decoded -- that is the whole
        // reason the parse step is instant -- so the list can appear as placeholders
        // straight away rather than materialising a second later.
        items: data.items ?? [],
        currentMethod: null,
        remaining: {},
        etaSeconds: 0,
      });
    } catch {
      toast("خطا در ارتباط با سرور", "error");
    } finally {
      setBusy(false);
    }
  }, [text, toast]);

  // Poll while a job is in flight. Stopping on completion is what keeps the panel from
  // asking about a finished job forever, and stops the row animations ticking.
  // The job id is read into a ref-free local so the interval is not torn down and
  // rebuilt on every poll -- otherwise each tick would cancel the next one.
  const jobId = snapshot?.job.id ?? null;
  const running = snapshot?.job.status === "running";
  useEffect(() => {
    if (jobId === null || !running) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/locations/parse/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!alive || !data.ok) return;
        setSnapshot(data as Snapshot);
        if (data.job.status === "done" && !notified.current) {
          notified.current = true;
          onAdded();
        }
      } catch {
        // A dropped poll is a missed frame, not a failure -- the next tick catches up.
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [jobId, running, onAdded]);

  // Reattach to a run already in progress, so a refresh mid-import does not orphan it.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/locations/parse/latest");
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data.ok && data.job?.status === "running") {
          setSnapshot(data as Snapshot);
        }
      } catch {
        /* nothing running, or offline -- the box is still usable either way */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cancel = useCallback(async () => {
    if (!snapshot) return;
    await fetch(`/api/locations/parse/${snapshot.job.id}/cancel`, { method: "POST" });
  }, [snapshot]);

  const undo = useCallback(async () => {
    if (!snapshot) return;
    const res = await fetch(`/api/locations/parse/${snapshot.job.id}/undo`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (data?.ok) {
      toast(`${faNum(data.removed)} مکان بازگردانده شد`, "success");
      onAdded();
    }
    setSnapshot(null);
  }, [snapshot, toast, onAdded]);

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <h2 className="sechead__title mb-2">افزودن از لینک</h2>

      {snapshot ? (
        <DecodeConsole
          snapshot={snapshot.job}
          items={snapshot.items}
          currentMethod={snapshot.currentMethod}
          remaining={snapshot.remaining}
          etaSeconds={snapshot.etaSeconds}
          onCancel={cancel}
          onUndo={undo}
          onDismiss={() => setSnapshot(null)}
        />
      ) : (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="لینک یا نتیجه جستجوی گوگل‌مپس، نشان، بلد یا ویز را اینجا پیست کنید…"
            className="w-full h-24 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:ring-1 focus:ring-accent resize-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[length:var(--text-xs)] text-text-faint">
              گوگل‌مپس، نشان، بلد و ویز پشتیبانی می‌شوند.
            </p>
            <button
              onClick={parse}
              disabled={busy || !text.trim()}
              className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "در حال تجزیه…" : "تجزیه"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
