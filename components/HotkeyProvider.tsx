"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BINDINGS, bindingFor, isReservedChord, isTypingTarget } from "@/lib/hotkeys";

/** The ONE `keydown` listener in the shell.
 *
 *  Everything else that listens — sixteen files, each correctly handling Escape for its own
 *  dialog — keeps doing so. This dispatches only what the registry declares, and every rule
 *  about WHEN is in `lib/hotkeys.ts` rather than here, so those rules are testable without a
 *  DOM. This file is the thin shell: ask the registry what this keystroke means, and do it.
 *
 *  Three things it refuses to do, each because the alternative is worse than no shortcut:
 *
 *  - fire while someone is typing in a field — the letter they pressed disappears;
 *  - touch Escape, Enter or Tab — they belong to whatever owns focus, and a registry that
 *    owned Escape is how a dialog stops closing;
 *  - fire a documentation-only binding — it documents a key that already has a listener.
 */
export default function HotkeyProvider() {
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (isReservedChord(e)) return;
      bindingFor(BINDINGS, pathname, e)?.run?.();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  return null;
}
