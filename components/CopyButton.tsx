"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { useToast } from "./ToastProvider";

/** A one-tap copy for a value that exists to be pasted somewhere else -- an address into
 *  a maps app, a phone number into the dialler, a coordinate pair into anything.
 *
 *  Confirms in place rather than only through a toast. The button is what the user is
 *  looking at when they press it, and a notification in the far corner of the screen is
 *  a strange place to answer a question asked here. The toast is still raised on
 *  failure, where the message needs more room than a tick.
 */
export default function CopyButton({
  value,
  label,
  what,
  className = "",
}: {
  value: string;
  /** Visible text. Omit for the bare icon, which is what the tight rows use. */
  label?: string;
  /** Names the thing in the failure message and to screen readers: "کپی آدرس". */
  what: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const toast = useToast();

  // The confirmation outlives the click by design, so it has to be cancelled if the
  // panel holding it closes first -- otherwise this sets state on an unmounted button.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function onClick() {
    const ok = await copyText(value);
    if (!ok) {
      toast(`${what} کپی نشد — دسترسی به کلیپ‌بورد ممکن نبود.`, "error");
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={what}
      title={what}
      className={`inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
        copied
          ? "border-good text-good"
          : "border-border text-text-faint hover:border-accent hover:text-accent"
      } ${className}`}
    >
      <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
      {label && <span>{copied ? "کپی شد" : label}</span>}
    </button>
  );
}
