"use client";

import type { ReactNode } from "react";
import { Reorder, useDragControls, type DragControls } from "framer-motion";
import { Icon } from "@/components/meridian/Icon";

/** One stop in the day list that can be dragged up or down by its grip, the neighbours making room.
 *  Only the grip starts a drag, so scrolling the page with a finger on the card still scrolls. The up and
 *  down arrows next to it stay for keyboards and for one-step moves. */
export default function DragStop({ id, onDrop, children }: { id: number; onDrop: () => void; children: (grip: ReactNode) => ReactNode }) {
  const controls: DragControls = useDragControls();
  const grip = (
    <button
      type="button"
      aria-label="جابه‌جایی توقف با کشیدن"
      className="touch dragstop__grip"
      onPointerDown={(e) => controls.start(e)}
    >
      <Icon name="grip-vertical" size="md" />
    </button>
  );
  return (
    <Reorder.Item as="li" value={id} dragListener={false} dragControls={controls} onDragEnd={onDrop} className="flex flex-col gap-2" whileDrag={{ scale: 1.02, zIndex: 5 }}>
      {children(grip)}
    </Reorder.Item>
  );
}
