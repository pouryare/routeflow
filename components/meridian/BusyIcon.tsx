"use client";

import { Spinner } from "@heroui/react";
import { Icon, type IconName } from "@/components/meridian/Icon";

/** The icon of an action button: its own icon at rest, a HeroUI Spinner while the action
 *  runs, and a popping check mark for a moment once it succeeded (`done`, see
 *  `useDoneFlash`) with a ring bursting out of it, so a saving button visibly works and then visibly finishes instead of
 *  just changing its words. Page content keeps skeletons; the spinner is only for something
 *  the person just tapped. */
export default function BusyIcon({ busy, done, name, size = "md" }: {
  busy?: boolean;
  done?: boolean;
  name: IconName;
  size?: "sm" | "md";
}) {
  // The check only mounts on success, so the burst runs once, as it appears.
  if (done) {
    return (
      <span className="burst" data-burst="">
        <Icon name="check" size={size} className="done-check" />
      </span>
    );
  }
  if (!busy) return <Icon name={name} size={size} />;
  return <Spinner size={size === "sm" ? "sm" : "md"} color="current" aria-label="در حال انجام" />;
}
