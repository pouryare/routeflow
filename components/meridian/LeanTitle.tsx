"use client";

import { useRef, type ReactNode } from "react";

/** A title whose words lean toward the finger or pointer, each by a different amount, and settle back
 *  when it leaves. Decoration only: it sets two CSS variables (see `.lean` in app/globals.css) and is
 *  off under reduced motion. */
export default function LeanTitle({ children }: { children: ReactNode }) {
  const el = useRef<HTMLSpanElement>(null);
  const aim = (e: React.PointerEvent) => {
    const r = el.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    el.current!.style.setProperty("--lx", String(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2))));
    el.current!.style.setProperty("--ly", String(Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2))));
  };
  const rest = () => {
    el.current?.style.removeProperty("--lx");
    el.current?.style.removeProperty("--ly");
  };
  return (
    <span ref={el} className="lean" onPointerMove={aim} onPointerLeave={rest} onPointerCancel={rest}>
      {children}
    </span>
  );
}
