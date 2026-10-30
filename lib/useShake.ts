"use client";

import { useEffect, useRef } from "react";
import { replay } from "@/lib/burst";
import { buzz } from "@/lib/haptic";
import { playSound } from "@/lib/sound";

/** A ref to put on the fields of a form: each time `failed` turns true they shake side to
 *  side and the phone knocks twice, so a wrong code or a refused save reads as "no" before
 *  the message under it is read. The words still say why; the shake only says that.
 *  460 ms is the shake (globals.css `[data-shake]`) plus a frame. */
export function useShakeOn<T extends HTMLElement>(failed: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!failed || !ref.current) return;
    buzz([30, 50, 30]);
    playSound("action.failed");
    return replay(ref.current, "data-shake", 460);
  }, [failed]);
  return ref;
}
