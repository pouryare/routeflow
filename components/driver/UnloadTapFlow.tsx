"use client";

// Where did the extras go?
//
// The app already knows: it loaded N, delivered M, so N-M are on the van. This sheet
// PRE-FILLS every line from the ledger and the driver confirms or corrects. Two consequences
// worth stating:
//
//   - The driver NEVER COMPUTES. He taps a disposition; the quantities are already there. A
//     tired man at 6pm counting crates by hand is a man making errors.
//   - Declaring LESS than the balance is refused, by name and by number. So the only way to
//     record a shortfall is to say where it went. A quiet difference would leave the van's
//     balance wrong forever with nothing recording that it was ever reconciled.
//
// More than one line is the NORMAL case — «خراب ۵ کیلو» beside «تاریخ مصرف گذشته ۲ کارتن».

import { useMemo, useState } from "react";
import { DISPOSITIONS, DISPOSITION_LABEL, type Disposition } from "@/lib/repo/unload";

export interface UnloadPreset {
  productId: number;
  productName: string;
  /** What the ledger says should come back. Pre-filled, and the reference the driver
   *  corrects against. */
  shouldReturn: number;
  /** Display units, e.g. kg or carton — whatever the driver thinks in. */
  unitLabel?: string;
}

export default function UnloadTapFlow({
  open,
  presets,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  presets: UnloadPreset[];
  busy?: boolean;
  /** Server-side refusal, shown verbatim. It names the gap by number, which is the point. */
  error?: string | null;
  onSubmit: (lines: { productId: number; disposition: Disposition; qty: number }[]) => void;
  onClose: () => void;
}) {
  // One disposition per product, defaulting to `returned` — the ordinary case. A sheet that
  // opened on "damaged" would be an accusation.
  const [picked, setPicked] = useState<Record<number, Disposition>>({});
  // A corrected quantity, only where the driver typed something different.
  const [qty, setQty] = useState<Record<number, string>>({});

  const lines = useMemo(
    () =>
      presets.map((p) => ({
        productId: p.productId,
        disposition: picked[p.productId] ?? "returned",
        qty:
          qty[p.productId] !== undefined && qty[p.productId] !== ""
            ? Number(qty[p.productId])
            : p.shouldReturn,
      })),
    [presets, picked, qty]
  );

  if (!open) return null;

  return (
    <Sheet onClose={onClose}>
      <p className="mb-3 text-[length:var(--text-xs)] text-text-muted">
        مقدارها از روی وانت پر شده‌اند. اگر چیزی فرق دارد، همان‌جا اصلاح کنید.
      </p>

      {presets.length === 0 && (
        <p className="mb-3 text-[length:var(--text-sm)] text-text-muted">
          چیزی روی وانت نیست که برگردد.
        </p>
      )}

      {presets.map((p) => {
        const declared = lines.find((l) => l.productId === p.productId)!;
        return (
          <div key={p.productId} className="mb-3 rounded-[var(--radius-md)] border border-border p-2">
            <div className="mb-1.5 text-[length:var(--text-sm)] text-text">{p.productName}</div>

            {/* The six dispositions, as buttons. Tap, do not type -- this runs on a phone,
                one-handed, at the end of a long day. */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {DISPOSITIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPicked((prev) => ({ ...prev, [p.productId]: d }))}
                  aria-pressed={declared.disposition === d}
                  className={`rounded-[var(--radius-sm)] border px-2 py-1 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                    declared.disposition === d
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-text-muted hover:border-text-faint"
                  }`}
                >
                  {DISPOSITION_LABEL[d]}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-[length:var(--text-xs)] text-text-muted">
              <span>{p.unitLabel ?? "مقدار"}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={qty[p.productId] ?? String(p.shouldReturn)}
                onChange={(e) => setQty((prev) => ({ ...prev, [p.productId]: e.target.value }))}
                className="w-24 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-[length:var(--text-xs)] text-text outline-none focus:border-accent"
              />
              <span className="text-text-faint">باید برگردد: {p.shouldReturn}</span>
            </label>
          </div>
        );
      })}

      {error && (
        <p className="mb-2 rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--crit)]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || presets.length === 0}
          onClick={() => onSubmit(lines)}
          className="flex-1 rounded-[var(--radius-md)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] text-accent-ink disabled:opacity-60"
        >
          {busy ? "در حال ثبت…" : "ثبت تخلیه"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-[length:var(--text-sm)] text-text-muted"
        >
          انصراف
        </button>
      </div>
    </Sheet>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3" dir="rtl">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-surface p-4">
        {children}
      </div>
    </div>
  );
}