"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { FieldInput } from "@/components/FieldInput";

/** How long the letter roll runs for a password of `len` letters: a beat per letter, capped. */
export const rollMs = (len: number) => Math.min(len, 24) * 35 + 260;

/** Shown over a password field for a moment after the eye opens it: each letter rolls in from a dot,
 *  one after another, then the plain field takes over. Decorative (aria-hidden); off with the effects
 *  switch and reduced motion, where the CSS hides it at once. */
export function PasswordRoll({ text, at }: { text: string; at: { x: number; font: string } }) {
  return (
    <span aria-hidden className="pwroll" dir="ltr" style={{ left: at.x, font: at.font }}>
      {[...text].slice(0, 24).map((ch, i) => (
        <span key={i} className="pwroll__ch" style={{ "--i": i } as React.CSSProperties}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** The eye's state with the roll timed to it: `shown` flips at once, `rolling` stays on while the letters roll.
 *  `box` is the element the roll is placed in; `at` is where its input's text starts inside it. */
export function usePasswordEye(text: string) {
  const [shown, setShown] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [at, setAt] = useState({ x: 12, font: "inherit" });
  const box = useRef<HTMLElement>(null);
  const toggle = () => {
    const next = !shown;
    setShown(next);
    const input = box.current?.querySelector("input");
    if (next && text && box.current && input) {
      const st = getComputedStyle(input);
      setAt({ x: input.getBoundingClientRect().left - box.current.getBoundingClientRect().left + (parseFloat(st.paddingLeft) || 0), font: st.font });
      setRolling(true);
      window.setTimeout(() => setRolling(false), rollMs(text.length));
    } else setRolling(false);
  };
  return { shown, rolling, toggle, at, box };
}

/** A FieldInput for a password or secret key with the same eye as PasswordInput (components/TextInput.tsx),
 *  for forms that put their own label around the field. */
export function FieldPassword({ value, label, ...props }: Omit<React.ComponentProps<typeof FieldInput>, "type"> & { value: string; label: string }) {
  const { shown, rolling, toggle, at, box } = usePasswordEye(value);
  return (
    <span ref={box} className="pwfield" data-rolling={rolling || undefined}>
      <FieldInput {...props} value={value} dir="ltr" type={shown ? "text" : "password"} aria-label={props["aria-label"] ?? label} />
      {rolling ? <PasswordRoll text={value} at={at} /> : null}
      <button type="button" className="pwfield__eye" aria-label={shown ? `پنهان کردن ${label}` : `نمایش ${label}`} onClick={toggle}>
        <Icon name={shown ? "eye-off" : "eye"} size="sm" />
      </button>
    </span>
  );
}
