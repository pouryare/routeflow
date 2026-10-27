"use client";

import type { ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Icon } from "@/components/meridian/Icon";

/** One widget failing must not take the page with it.
 *
 *  `app/(shell)/error.tsx` replaces the whole page body when anything under it throws, which
 *  is right for a page that cannot render but wrong for a map whose tile library failed to
 *  load, a chart handed a bad number, or a sheet body that threw: the reader loses the
 *  customer list, the header's search and everything else that was working. This catches at
 *  the widget instead, says which widget it was, and offers a retry in place.
 *
 *  Put it around a thing that can fail on its own (a map, a chart, a sheet body, a header
 *  widget), not around every small element: a boundary on a label adds a wrapper and hides
 *  nothing worth hiding.
 *
 *  `reset` re-renders the children, which is the fix for a chunk that failed to download on
 *  a bad connection. `resetKeys` re-tries by itself when the thing the widget shows changes
 *  (a different customer's map), so a stale failure is not left standing. */
export default function WidgetBoundary({
  label,
  children,
  resetKeys,
  compact = false,
}: {
  /** What this is, in the words of the reader: «نقشه», «نمودار فروش». Shown in the fallback. */
  label: string;
  children: ReactNode;
  resetKeys?: unknown[];
  /** For a small slot (the header): a single quiet line instead of a card. */
  compact?: boolean;
}) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error) => {
        // Reaches the browser console today; the roadmap's structured logging and the
        // self-hosted error tracker (F108) are where it will go next.
        console.error(`[WidgetBoundary] ${label}`, error);
      }}
      fallbackRender={(props) => <WidgetFallback {...props} label={label} compact={compact} />}
    >
      {children}
    </ErrorBoundary>
  );
}

function WidgetFallback({
  resetErrorBoundary,
  label,
  compact,
}: FallbackProps & { label: string; compact: boolean }) {
  return (
    <div
      role="alert"
      className={
        compact
          ? "inline-flex items-center gap-[var(--space-2)]"
          : "card flex flex-col items-center gap-[var(--space-3)] p-[var(--space-4)] text-center"
      }
    >
      {compact ? null : (
        <span aria-hidden="true">
          <Icon name="warn" size="md" />
        </span>
      )}
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">{label} درست بار نشد</p>
      <button
        type="button"
        className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost"
        onClick={resetErrorBoundary}
        aria-label={`تلاش دوباره برای ${label}`}
      >
        <Icon name="undo" size="md" />
        تلاش دوباره
      </button>
    </div>
  );
}
