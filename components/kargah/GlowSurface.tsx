"use client";

import { useRef } from "react";
import { useTiltGlow } from "@/lib/design/tilt";
import { cn } from "@/lib/cn";

/** Cursor-follow glow WITHOUT the 3D tilt -- for surfaces that want the lit-edge effect
 *  but not the perspective rotation (e.g. wide list rows, where tilt would look wrong). */
export default function GlowSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useTiltGlow(ref);
  return (
    <div ref={ref} className={cn("glow-container", className)}>
      <div data-glow className="glow-card">
        {children}
      </div>
    </div>
  );
}
