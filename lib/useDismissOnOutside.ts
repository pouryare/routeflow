"use client";

import { useEffect, type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";

/** Close a popover when the user presses outside it or hits Escape, while `open`.
 *
 *  A popover that cannot be dismissed by looking away is a popover that is in the way. */
export function useDismissOnOutside(
  open: boolean,
  onDismiss: () => void,
  root: RefObject<HTMLElement | null>
): void {
  useEscapeKey(onDismiss, open);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onDismiss, root]);
}
