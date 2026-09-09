import type { HTMLAttributes, ReactNode } from "react";

/** Puts any card in a document pocket: 1-3 slips peek over its top edge and fan out on
 *  hover / focus. The slips are siblings of the face and the face is never
 *  `overflow:hidden` -- z-index does the layering, the same way the bespoke PocketCard
 *  on /sales/orders always has. See `.pocketed` in app/globals.css.
 *
 *  `papers` should be the real count of attached documents (clamped 0..3); at 0 it
 *  renders as a plain card with no top gutter. `tone` paints the slip's top edge with a
 *  status colour. `fan` (default on) is the hover fan-out -- turn it OFF for dense grids
 *  where a dozen cards fanning at once is noise.
 */
export default function Pocketed({
  papers = 2,
  tone,
  fan = true,
  slips,
  children,
  className = "",
  ...rest
}: {
  papers?: 0 | 1 | 2 | 3;
  tone?: "good" | "warn" | "crit" | "info";
  fan?: boolean;
  /** Custom slip contents; defaults to blank sheets. */
  slips?: ReactNode;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const n = Math.max(0, Math.min(3, papers)) as 0 | 1 | 2 | 3;
  return (
    <div
      className={`pocketed ${className}`.trim()}
      data-papers={n}
      data-tone={tone}
      data-fan={fan ? "" : undefined}
      {...rest}
    >
      {n > 0 && (
        <div className="pocketed__slips" aria-hidden="true">
          {slips ??
            Array.from({ length: n }, (_, i) => <span className="pocketed__slip" key={i} />)}
        </div>
      )}
      <div className="pocketed__face">{children}</div>
    </div>
  );
}
