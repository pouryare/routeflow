"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { faNum } from "@/lib/format";
import type { DeckChoice } from "@/lib/decisions";

/** A queue of things that each need a one-tap verdict, shown one card at a time: the card, the
 *  verdict buttons (52 px, the tone shows what a tap means), «بعداً» to skip, and «۳ از ۱۲» so the
 *  end is in sight. A verdict calls `onDecide` and moves on at once -- the caller runs it through
 *  the 5 s undo (useUndoableAction), so there is no "are you sure?" between cards.
 *
 *  The sheet gets a fixed `items` snapshot: the list behind it refreshes as verdicts land, and the
 *  deck must not shuffle under a thumb. Swiping is not offered here (a sheet already listens for
 *  swipe-down); the buttons are the whole interface. Mount it with a fresh `key` per opening. */
export default function DecisionDeck<T>({
  open,
  title,
  items,
  keyOf,
  render,
  choices,
  onDecide,
  onClose,
}: {
  open: boolean;
  title: string;
  items: T[];
  keyOf: (t: T) => string | number;
  render: (t: T) => ReactNode;
  choices: DeckChoice[];
  onDecide: (item: T, choice: string) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState(0);
  const [decided, setDecided] = useState(0);
  const item = items[at];
  const next = () => setAt((i) => i + 1);

  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className="deck">
        {item === undefined ? (
          <div className="deck__done">
            <Icon name="check" size="lg" />
            <p>{decided > 0 ? `همه تصمیم‌ها گرفته شد · ${faNum(decided)} مورد` : "موردی برای تصمیم‌گیری نیست"}</p>
            <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go" onClick={onClose}>
              <Icon name="check" size="md" />
              بستن این فهرست
            </button>
          </div>
        ) : (
          <>
            <p className="deck__progress" aria-live="polite">
              {faNum(at + 1)} از {faNum(items.length)}
            </p>
            <div className="deck__card" key={keyOf(item)}>
              {render(item)}
            </div>
            <div className="deck__choices">
              {choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`inline-flex items-center justify-center gap-[var(--space-2)] tf-opt${c.tone === "bad" ? " bad" : c.tone === "good" ? " rec" : ""}`}
                  onClick={() => {
                    onDecide(item, c.id);
                    setDecided((n) => n + 1);
                    next();
                  }}
                >
                  <Icon name={c.tone === "bad" ? "x" : "check"} size="md" />
                  {c.label}
                </button>
              ))}
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-skip" onClick={next}>
                <Icon name="arrow-left" size="md" />
                این مورد بعداً
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
