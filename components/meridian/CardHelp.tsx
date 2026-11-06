"use client";

import { HelpHint } from "@/components/meridian/HelpHint";
import { getHelp, isTodo } from "@/lib/help";
import { usePathname } from "next/navigation";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { useTutorials } from "@/components/tutorials/TutorialProvider";
import { TUTORIALS } from "@/lib/tutorials/catalog";
import { tutorialsFor } from "@/lib/tutorials/engine";

/** The `(?)` that belongs in a page header. Its copy comes from lib/help, keyed by an id; an id
 *  with no copy yet renders a calm placeholder rather than nothing. The button and popover are
 *  `HelpHint`, the same `(?)` every component uses. */
export function CardHelp({ id, className }: { id: string; className?: string }) {
  const entry = getHelp(id);
  /* «چطور…؟» (idea I2): the tutorials written for this screen, one tap to start. */
  const pathname = usePathname();
  const { role, start } = useTutorials();
  const path = pathname ?? "";
  const here = role ? tutorialsFor(role, TUTORIALS).filter((t) => !t.autoStart && (path === t.screen || path.startsWith(`${t.screen}/`))).slice(0, 4) : [];

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
      {here.length > 0 ? (
        <div className="mhelp__tuts">
          <span className="mhelp__how-label">آموزش این صفحه:</span>
          {here.map((t) => (
            <Button key={t.id} size="sm" variant="secondary" onPress={() => start(t.id)}>
              <Icon name="play" size="sm" /> {t.title}
            </Button>
          ))}
        </div>
      ) : null}
    </HelpHint>
  );
}

export default CardHelp;
