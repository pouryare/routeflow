import { cn } from "@/lib/cn";
import type { BentoSpan } from "@/lib/design/bentoSpan";

/** The page-layout grid from spec 2026-09-08 §9b -- unequal-width tiles in one row,
 *  not equal thirds pretending every tile matters the same amount. `bentoSpanForIndex`
 *  (lib/design/bentoSpan.ts) picks the span for a dynamic-length list of tiles; a
 *  hand-laid-out page can pass `span` directly instead. */
export function Bento({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("bento", className)}>{children}</div>;
}

export function BentoCell({
  span,
  className,
  children,
}: {
  span: BentoSpan;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-span={span} className={className}>
      {children}
    </div>
  );
}
