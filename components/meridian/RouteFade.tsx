"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Remounts its subtree on every sales path change so the CSS entrance in
 *  app/globals.css (`.meridian .route-fade` -> @keyframes meridian-route-in) replays.
 *
 *  Pure CSS: deterministic, fires on every navigation, no requestAnimationFrame. The
 *  keyframe's `from { opacity: 0 }` under `both` also masks the one blank frame before
 *  RevealRoute's effect sets the cards to opacity:0. The per-card spring cascade
 *  (RevealRoute) layers on top of this whole-view fade.
 */
export default function RouteFade({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="route-fade" key={pathname}>
      {children}
    </div>
  );
}
