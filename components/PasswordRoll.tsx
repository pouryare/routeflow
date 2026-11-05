"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { FieldInput } from "@/components/FieldInput";

/** How long the letter roll runs for a password of `len` letters: a beat per letter, capped. */
export const rollMs = (len: number) => Math.min(len, 24) * 35 + 260;

/** Shown over a password field for a moment after the eye opens it: each letter rolls in from a dot,
 *  one after another, then the plain field takes over. Decorative (aria-hidden); off with the effects
 *  switch and reduced motion, where the CSS hides it at once. */
export function PasswordRoll({ text }: { text: string }) {
  return (
    <span aria-hidden className="pwroll" dir="ltr">
      {[...text].slice(0, 24).map((ch, i) => (
        <span key={i} className="pwroll__ch" style={{ "--i": i } as React.CSSProperties}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** The eye's state with the roll timed to it: `shown` flips at once, `rolling` stays on while the letters roll. */
export function usePasswordEye(text: string) {
  const [shown, setShown] = useState(false);
  const [rolling, setRolling] = useState(false);
  const toggle = () => {
    const next = !shown;
    setShown(next);
    if (next && text) {
      setRolling(true);
      window.setTimeout(() => setRolling(false), rollMs(text.length));
    } else setRolling(false);
  };
  return { shown, rolling, toggle };
}

/** A FieldInput for a password or secret key with the same eye as PasswordInput (components/TextInput.tsx),
 *  for forms that put their own label around the field. */
export function FieldPassword({ value, label, ...props }: Omit<React.ComponentProps<typeof FieldInput>, "type"> & { value: string; label: string }) {
  const eye = usePasswordEye(value);
  return (
    <span className="pwfield" data-rolling={eye.rolling || undefined}>
      <FieldInput {...props} value={value} dir="ltr" type={eye.shown ? "text" : "password"} aria-label={props["aria-label"] ?? label} />
      {eye.rolling ? <PasswordRoll text={value} /> : null}
      <button type="button" className="pwfield__eye" aria-label={eye.shown ? `پنهان کردن ${label}` : `نمایش ${label}`} onClick={eye.toggle}>
        <Icon name={eye.shown ? "eye-off" : "eye"} size="sm" />
      </button>
    </span>
  );
}
