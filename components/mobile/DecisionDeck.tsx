"use client";

import { HelpHint, HelpRow } from "@/components/meridian/HelpHint";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import { Button } from "@heroui/react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton, SkipButton } from "@/components/tapflow/Answer";
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
    <BottomSheet open={open} title={title} onClose={onClose} closeLabel="بستن تصمیم‌ها">
      <div className="deck">
        <HelpRow>
          <HelpHint title="تصمیم‌ها" label="راهنمای تصمیم‌ها">
            <p className="mhelp__what">هر کارت یک تصمیم می‌خواهد؛ یکی از دکمه‌ها را بزنید تا کارت بعدی بیاید.</p>
            <p className="mhelp__how">«بعداً» کارت را رد می‌کند. هر تصمیم تا ۵ ثانیه قابل برگشت است.</p>
          </HelpHint>
        </HelpRow>
        {item === undefined ? (
          <div className="deck__done">
            <Icon name="check" size="lg" />
            <p>{decided > 0 ? `همه تصمیم‌ها گرفته شد · ${faNum(decided)} مورد` : "موردی برای تصمیم‌گیری نیست"}</p>
            <Button variant="primary" size="lg" fullWidth onPress={onClose}>
              <Icon name="x" size="md" />
              بستن این فهرست
            </Button>
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
                <AnswerButton
                  key={c.id}
                  icon={c.tone === "bad" ? "x" : "check"}
                  tone={c.tone === "bad" ? "bad" : c.tone === "good" ? "rec" : undefined}
                  onPress={() => {
                    onDecide(item, c.id);
                    setDecided((n) => n + 1);
                    next();
                  }}
                >
                  {c.label}
                </AnswerButton>
              ))}
              <SkipButton icon="clock" onPress={next}>این مورد بعداً</SkipButton>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
