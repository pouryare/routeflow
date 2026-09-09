import { cn } from "@/lib/cn";

/** A frosted glass surface -- backdrop-filter blur+saturate, so whatever sits behind it
 *  bleeds through as a soft wash of colour. Restricted by design to modal backdrops, the
 *  sticky header, and the pocket's document face -- NOT applied to plain cards, both
 *  because the reference video's cards are opaque white and because backdrop-filter is
 *  the single most expensive property in this system (perf budget caps it at ~6
 *  simultaneous instances). */
export default function GlassFace({
  tint,
  className,
  children,
  ...rest
}: {
  tint?: string;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("glass-face", className)}
      style={tint ? ({ "--glass-tint": tint } as React.CSSProperties) : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
