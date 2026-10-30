"use client";

import { HelpHint, HelpRow } from "@/components/meridian/HelpHint";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import { Button } from "@heroui/react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton, SkipButton } from "@/components/tapflow/Answer";
import { faNum } from "@/lib/format";
import { throwVerdict, type DeckChoice } from "@/lib/decisions";
import { buzz } from "@/lib/haptic";

/** A queue of things that each need a one-tap verdict, shown one card at a time: the card, the
 *  verdict buttons (52 px, the tone shows what a tap means), «بعداً» to skip, and «۳ از ۱۲» so the
 *  end is in sight. A verdict calls `onDecide` and moves on at once -- the caller runs it through
 *  the 5 s undo (useUndoableAction), so there is no "are you sure?" between cards.
 *
 *  The sheet gets a fixed `items` snapshot: the list behind it refreshes as verdicts land, and the
 *  deck must not shuffle under a thumb. When the deck has one good and one bad verdict the card can
 *  also be thrown sideways (right = good, left = bad, see `throwVerdict`); sideways does not clash
 *  with the sheet's swipe-down, and the buttons stay for everyone else. Mount it with a fresh
 *  `key` per opening. */
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
  const decide = (it: T, id: string) => {
    onDecide(it, id);
    setDecided((n) => n + 1);
    next();
  };
  const canThrow = throwVerdict(choices, 1e3, 0) !== null;
  const good = choices.find((c) => c.tone === "good");
  const bad = choices.find((c) => c.tone === "bad");

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
            {canThrow ? (
              <ThrowCard key={keyOf(item)} onThrow={(dx, v) => {
                const id = throwVerdict(choices, dx, v);
                if (id === null) return false;
                buzz();
                decide(item, id);
                return true;
              }}>
                {render(item)}
              </ThrowCard>
            ) : (
              <div className="deck__card" key={keyOf(item)}>
                {render(item)}
              </div>
            )}
            {canThrow && good && bad ? (
              <p className="deck__hint">کارت را بکشید: به راست = {good.label} · به چپ = {bad.label}</p>
            ) : null}
            <div className="deck__choices">
              {choices.map((c) => (
                <AnswerButton
                  key={c.id}
                  icon={c.tone === "bad" ? "x" : "check"}
                  tone={c.tone === "bad" ? "bad" : c.tone === "good" ? "rec" : undefined}
                  onPress={() => decide(item, c.id)}
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

/** The card under a thumb: it follows the finger sideways, tilts a little, and goes (via `onThrow`,
 *  which says whether the throw counted) or springs back. */
function ThrowCard({ children, onThrow }: { children: ReactNode; onThrow: (dx: number, vx: number) => boolean }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-6, 6]);
  return (
    <motion.div
      className="deck__card deck__card--throw"
      style={{ x, rotate }}
      drag="x"
      dragDirectionLock
      dragSnapToOrigin
      dragElastic={0.7}
      onDragEnd={(_, info) => { onThrow(info.offset.x, info.velocity.x); }}
    >
      {children}
    </motion.div>
  );
}
