"use client";

import { useState, type DragEvent } from "react";

/** Make an element a drop target for one file: spread `props` on it, and `over` says a file is hovering. */
export function useDropFile(onFile: (f: File) => void) {
  const [over, setOver] = useState(false);
  const props = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
  };
  return { over, props };
}
