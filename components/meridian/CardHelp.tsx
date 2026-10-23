"use client";

import { Button, Popover } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { getHelp, isTodo } from "@/lib/help";

/** The `(i)` button that belongs in a card header. A tap (a deliberate act, not hover) opens
 *  a small HeroUI Popover: what the figure shows, and how to read it. An id with no copy yet
 *  renders a calm placeholder rather than nothing.
 *
 *  A Popover, not a Tooltip: a tooltip never opens on touch, and this is text people must be
 *  able to read on a phone. React Aria brings the outside-tap and Escape dismissal, the focus
 *  move and return, and the flip when the card sits at the bottom of the screen. */
export function CardHelp({ id, className }: { id: string; className?: string }) {
  const entry = getHelp(id);

  return (
    <span className={`mhelp${className ? ` ${className}` : ""}`}>
      <Popover>
        <Button isIconOnly variant="ghost" size="sm" className="mhelp__trigger" aria-label="راهنمای این بخش">
          <Icon name="info" size="sm" />
        </Button>
        <Popover.Content placement="bottom end" offset={6} className="mhelp__panel">
          <Popover.Dialog aria-label="راهنما" className="mhelp__dialog">
            {isTodo(entry) ? (
              <p className="mhelp__todo">راهنمای این بخش به‌زودی</p>
            ) : (
              <>
                <Popover.Heading className="mhelp__title">{entry.title}</Popover.Heading>
                <p className="mhelp__what">{entry.what}</p>
                <p className="mhelp__how">
                  <span className="mhelp__how-label">چطور بخوانیم:</span> {entry.how}
                </p>
              </>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </span>
  );
}

export default CardHelp;
