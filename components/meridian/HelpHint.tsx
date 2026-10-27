"use client";

import type { ReactNode } from "react";
import { Button, Popover } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";

/** The `(?)` every component uses for its small help: a tap opens a HeroUI Popover with a title
 *  and a few lines. One component, so help looks and behaves the same everywhere; `CardHelp`
 *  (the page header's help, copy from lib/help) is this with the registry's text.
 *
 *  A Popover, not a Tooltip: a tooltip never opens on touch, and this is text people must be
 *  able to read on a phone. React Aria brings the outside-tap and Escape dismissal, the focus
 *  move and return, and the flip when the component sits at the bottom of the screen.
 *
 *  The button is 44 px to tap and pulled back with a negative margin, so it takes only about
 *  20 px of layout. `label` names it for a screen reader («راهنمای تاریخ»). */
export function HelpHint({
  title,
  children,
  label = "راهنمای این بخش",
  placement = "bottom end",
  className,
}: {
  title?: string;
  children: ReactNode;
  label?: string;
  placement?: "bottom end" | "bottom start" | "top end" | "top start";
  className?: string;
}) {
  return (
    <span className={`mhelp${className ? ` ${className}` : ""}`}>
      <Popover>
        <Button isIconOnly variant="ghost" size="sm" className="mhelp__trigger" aria-label={label}>
          <Icon name="help" size="sm" />
        </Button>
        <Popover.Content placement={placement} offset={6} className="mhelp__panel">
          <Popover.Dialog aria-label="راهنما" className="mhelp__dialog">
            {title ? <Popover.Heading className="mhelp__title">{title}</Popover.Heading> : null}
            {children}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </span>
  );
}

/** A row that carries a component's `(?)` at its end, above the component, so every hint sits
 *  in the same corner. Takes about 20 px of height. */
export function HelpRow({ children }: { children: ReactNode }) {
  return <div className="helprow">{children}</div>;
}

export default HelpHint;
