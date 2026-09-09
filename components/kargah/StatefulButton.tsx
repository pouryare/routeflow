"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { nextButtonState, type ButtonState } from "@/lib/design/statefulButton";

/** idle -> loading -> success -> idle. Confirmed live in the reference video on "Take
 *  for Processing" and "Add Case" -- this is not a speculative addition. */
export default function StatefulButton({
  onClick,
  children,
  className,
  successDurationMs = 1200,
}: {
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  successDurationMs?: number;
}) {
  const [state, setState] = useState<ButtonState>("idle");

  const handleClick = async () => {
    setState((s) => nextButtonState(s, "click"));
    if (state !== "idle") return;
    try {
      await onClick();
      setState((s) => nextButtonState(s, "resolve"));
      setTimeout(() => setState((s) => nextButtonState(s, "timeout")), successDurationMs);
    } catch {
      setState((s) => nextButtonState(s, "reject"));
    }
  };

  return (
    <button
      type="button"
      data-state={state}
      onClick={handleClick}
      disabled={state === "loading"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)]",
        "bg-[var(--primary)] px-6 py-3 text-[var(--primary-ink)]",
        "transition-transform active:scale-[0.97] disabled:opacity-80",
        className,
      )}
    >
      {state === "loading" && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {state === "success" && (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === "idle" && children}
      {state === "loading" && <span>در حال پردازش...</span>}
      {state === "success" && <span>انجام شد</span>}
    </button>
  );
}
