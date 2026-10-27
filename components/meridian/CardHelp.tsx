"use client";

import { HelpHint } from "@/components/meridian/HelpHint";
import { getHelp, isTodo } from "@/lib/help";

/** The `(?)` that belongs in a page header. Its copy comes from lib/help, keyed by an id; an id
 *  with no copy yet renders a calm placeholder rather than nothing. The button and popover are
 *  `HelpHint`, the same `(?)` every component uses. */
export function CardHelp({ id, className }: { id: string; className?: string }) {
  const entry = getHelp(id);

  return (
    <HelpHint title={isTodo(entry) ? undefined : entry.title} className={className}>
      {isTodo(entry) ? (
        <p className="mhelp__todo">راهنمای این بخش به‌زودی</p>
      ) : (
        <>
          <p className="mhelp__what">{entry.what}</p>
          <p className="mhelp__how">
            <span className="mhelp__how-label">چطور بخوانیم:</span> {entry.how}
          </p>
        </>
      )}
    </HelpHint>
  );
}

export default CardHelp;
