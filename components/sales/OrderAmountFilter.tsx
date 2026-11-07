"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import RangeBar from "@/components/mobile/RangeBar";
import { Icon } from "@/components/meridian/Icon";
import { faDigits, faToman } from "@/lib/format";
import { countIn, histogram, type Bounds } from "@/lib/rangeBar";

/** The orders list's amount filter: drag the two ends, let go, and the list is read again with `?min=&max=`
 *  (other parts of the address are kept). It is shown only when the orders have more than one amount. */
export default function OrderAmountFilter({
  bounds,
  active,
  amounts,
}: {
  bounds: Bounds;
  active: [number, number] | null;
  /** Every order total this person can see: the bars above the track and the live count read it. */
  amounts: number[];
}) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [value, setValue] = useState<[number, number]>(active ?? [bounds.min, bounds.max]);
  const [bars] = useState(() => histogram(amounts, bounds));

  const go = (next: [number, number] | null) => {
    const q = new URLSearchParams(search.toString());
    if (next) {
      q.set("min", String(next[0]));
      q.set("max", String(next[1]));
    } else {
      q.delete("min");
      q.delete("max");
    }
    router.replace(q.size ? `${path}?${q}` : path);
  };

  return (
    <div className="mx-[var(--space-4)] mb-[var(--space-3)] flex items-end gap-[var(--space-3)]">
      <div className="min-w-0 flex-1">
        <RangeBar
          label="مبلغ سفارش"
          bounds={bounds}
          value={value}
          format={(n) => faToman(n)}
          onChange={setValue}
          onCommit={(v) => go(v[0] === bounds.min && v[1] === bounds.max ? null : v)}
          bars={bars}
        />
        <p aria-live="polite" className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
          {faDigits(String(countIn(amounts, value)))} سفارش در این بازه
        </p>
      </div>
      {active && (
        <button
          type="button"
          className="touch inline-flex min-h-[44px] shrink-0 items-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--muted)]"
          onClick={() => {
            setValue([bounds.min, bounds.max]);
            go(null);
          }}
        >
          <Icon name="x" size="sm" />
          پاک کردن مبلغ
        </button>
      )}
    </div>
  );
}
