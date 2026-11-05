"use client";

import { Icon } from "@/components/meridian/Icon";
import { faDigits } from "@/lib/format";

/** A photo on its way up (owner, 2026-11-05): the picture itself, dimmed, with a ring that fills
 *  and «۶۰٪» in the middle; at the end a check. A failed upload turns the ring red and offers
 *  «دوباره» on the same spot, so proof of a delivery is never left sitting there unsent. */
export default function UploadTile({ src, percent, state, onRetry, onDismiss }: {
  src: string;
  percent: number;
  state: "sending" | "done" | "failed";
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const r = 20;
  const len = 2 * Math.PI * r;
  return (
    <div className="uploadtile" data-state={state}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the photo being sent */}
      <img src={src} alt="" />
      <div className="uploadtile__veil" role="status" aria-live="polite">
        {state === "failed" ? (
          <>
            <span className="sr-only">بارگذاری عکس ناموفق بود</span>
            <button type="button" className="uploadtile__retry" onClick={onRetry}>
              <Icon name="refresh" size="sm" />
              دوباره
            </button>
            <button type="button" className="uploadtile__drop" aria-label="کنار گذاشتن این عکس" onClick={onDismiss}>
              <Icon name="x" size="sm" />
            </button>
          </>
        ) : (
          <span className="uploadtile__ring">
            <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r={r} className="uploadtile__track" />
              <circle cx="24" cy="24" r={r} className="uploadtile__fill" strokeDasharray={len} strokeDashoffset={len * (1 - percent / 100)} />
            </svg>
            {state === "done" ? <Icon name="check" size="md" className="done-check" /> : <b>{faDigits(String(percent))}٪</b>}
          </span>
        )}
      </div>
    </div>
  );
}
