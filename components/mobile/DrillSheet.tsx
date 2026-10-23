"use client";

import type { ReactNode } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";

/** The breakdown behind a card, in a sheet, so looking closer does not mean leaving the page
 *  (and losing the scroll position of the cards underneath). */
export default function DrillSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose} closeLabel="بستن جزئیات">
      <div className="drillsheet">{children}</div>
    </BottomSheet>
  );
}
