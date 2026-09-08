"use client";

import { useRef } from "react";
import { useTiltGlow } from "@/lib/design/tilt";
import { cn } from "@/lib/cn";

/** Wraps any card in the delegated tilt+glow container. One container can hold MANY
 *  TiltCards -- the listener lives on the container, not on each card -- so wrap a whole
 *  board in one container rather than one per card where possible. A standalone card
 *  wraps itself. */
export default function TiltCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useTiltGlow(ref);
  return (
    <div ref={ref} className={cn("tilt-container", className)}>
      <div data-tilt data-glow className="tilt-card">
        {children}
      </div>
    </div>
  );
}
