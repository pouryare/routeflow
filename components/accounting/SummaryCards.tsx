"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import DrillSheet from "@/components/mobile/DrillSheet";
import { faNum } from "@/lib/format";
import type { SummaryCard } from "@/lib/accountingCards";

/** A report's sections as stacked cards for a phone (the wide table stays from 768px up). A card
 *  with lines behind it opens them in a sheet; the others are plain. */
export default function SummaryCards({ cards, ariaLabel }: { cards: SummaryCard[]; ariaLabel: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = cards.find((c) => c.id === open) ?? null;
  const cls = (c: SummaryCard) => `summarycard${c.strong ? " summarycard--strong" : ""}${c.total ? " summarycard--total" : ""}`;
  return (
    <>
    <ul className="summarycards" aria-label={ariaLabel}>
      {cards.map((c) =>
        c.lines ? (
          <li key={c.id}>
            <button type="button" className={cls(c)} onClick={() => setOpen(c.id)}>
              <span>
                <Icon name="chevron-down" size="sm" /> {c.label}
              </span>
              <span className="tnum">{faNum(c.value)}</span>
            </button>
          </li>
        ) : (
          <li key={c.id} className={cls(c)}>
            <span>{c.label}</span>
            <span className="tnum">{faNum(c.value)}</span>
          </li>
        ),
      )}
    </ul>
      <DrillSheet open={current !== null} title={current?.label ?? ""} onClose={() => setOpen(null)}>
        {(current?.lines ?? []).map((l) => (
          <div key={l.label} className="summarycard">
            <span>{l.label}</span>
            <span className="tnum">{faNum(l.value)}</span>
          </div>
        ))}
      </DrillSheet>
    </>
  );
}
