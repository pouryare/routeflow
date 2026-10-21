"use client";

import { createPortal } from "react-dom";
import { useRef, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useSheetHost } from "@/components/meridian/useSheetHost";
import { useSwipeDismiss } from "@/components/useSwipeDismiss";
import { useEscapeKey } from "@/lib/useEscapeKey";

/** A plain bottom sheet for the phone chrome (the «بیشتر» list, the quick actions): the same
 *  scrim, grab handle, close button, swipe-down and Escape as a TapFlow sheet, drawn in the
 *  `.meridian` root so a transformed ancestor cannot misplace it (useSheetHost). The body sits in
 *  `.tapflow` so its rows can use the 52 px answer-button styles. */
export default function BottomSheet({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  useSwipeDismiss(sheet, "down", onClose, open);
  useEscapeKey(onClose, open);
  const host = useSheetHost();
  if (!host) return null;
  return createPortal(
    <>
      <div className={`meridian-scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden />
      <div ref={sheet} className={`sheet${open ? " on" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open} inert={!open}>
        <div className="grab" />
        <div className="sheethead">
          <div>
            <h2>{title}</h2>
          </div>
          <button className="inline-flex items-center justify-center gap-[var(--space-2)] x x--labelled" type="button" aria-label="بستن" onClick={onClose}>
            <Icon name="x" size="sm" />
            <span>بستن</span>
          </button>
        </div>
        <div className="tapflow">{children}</div>
      </div>
    </>,
    host,
  );
}
