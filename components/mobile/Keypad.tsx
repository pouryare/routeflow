"use client";

import { useEffect, useRef } from "react";
import { HelpHint, HelpRow } from "@/components/meridian/HelpHint";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { display, keyFromEvent, press, quickAmounts, type Key } from "@/lib/keypad";

const ROWS: Key[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
];

/** A number pad of our own, so the OS keyboard never covers the field. The value is a string
 *  (digits and at most one point); the readout shows it in Persian digits with its unit. A
 *  hardware keyboard still works (digits, backspace, Enter) for desk use, without ever raising
 *  the on-screen one: focus lands on this panel, not on a text field. */
export default function Keypad({
  value,
  onChange,
  onEnter,
  decimal = false,
  unit,
  suggested,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  decimal?: boolean;
  /** Printed after the number. */
  unit?: string;
  /** If given, its round-up neighbours are offered as one-tap chips (money). */
  suggested?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  const quick = suggested ? quickAmounts(suggested) : [];
  const tap = (k: Key) => onChange(press(value, k, decimal));

  return (
    <div
      ref={panel}
      className="keypad"
      tabIndex={0}
      onKeyDown={(e) => {
        const k = keyFromEvent(e);
        if (!k) return;
        e.preventDefault();
        if (k === "enter") onEnter?.();
        else tap(k);
      }}
    >
      <HelpRow>
        <HelpHint title="وارد کردن عدد" label="راهنمای وارد کردن عدد">
          <p className="mhelp__what">عدد را با کلیدها بنویسید. «۰۰۰» سه صفر اضافه می‌کند و پیکان آخرین رقم را پاک می‌کند.</p>
          <p className="mhelp__how">اگر عددی پیشنهاد شده بود، با یک لمس جای عدد می‌نشیند.</p>
        </HelpHint>
      </HelpRow>
      <div className="keypad__readout" role="status" aria-live="polite">
        <strong>{display(value)}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      {quick.length > 0 && (
        <div className="keypad__quick">
          {quick.map((q) => (
            <button key={q} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] keypad__chip" onClick={() => onChange(String(q))}>
              <Icon name="check" size="sm" />
              {faNum(q)}
            </button>
          ))}
        </div>
      )}
      <div className="keypad__grid" dir="ltr">
        {ROWS.flat().map((k) => (
          <button key={k} type="button" className="keypad__key" onClick={() => tap(k)}>
            {/* A digit key: the numeral is its whole label, and a glyph beside it would only slow the thumb. */}
            {faNum(Number(k))}
          </button>
        ))}
        {decimal ? (
          <button type="button" className="keypad__key" aria-label="ممیز" onClick={() => tap(".")}>
            {/* The decimal point: the mark itself is the label, as on any calculator. */}
            ٫
          </button>
        ) : (
          <button type="button" className="keypad__key" aria-label="سه صفر" onClick={() => tap("000")}>
            {/* «۰۰۰» saves three taps on a money amount; the zeros are the label, no glyph needed. */}
            ۰۰۰
          </button>
        )}
        <button type="button" className="keypad__key" onClick={() => tap("0")}>
          {/* A digit key: the numeral is its whole label, and a glyph beside it would only slow the thumb. */}
          ۰
        </button>
        <button type="button" className="keypad__key" aria-label="پاک کردن یک رقم" onClick={() => tap("⌫")}>
          <Icon name="arrow-right" size="md" />
        </button>
      </div>
    </div>
  );
}
