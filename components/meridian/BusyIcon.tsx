"use client";

import { Spinner } from "@heroui/react";
import { Icon, type IconName } from "@/components/meridian/Icon";

/** The icon of an action button, swapped for a HeroUI Spinner while the action runs, so a
 *  saving button visibly works instead of just changing its words. Page content keeps
 *  skeletons; the spinner is only for something the person just tapped. */
export default function BusyIcon({ busy, name, size = "md" }: {
  busy?: boolean;
  name: IconName;
  size?: "sm" | "md";
}) {
  if (!busy) return <Icon name={name} size={size} />;
  return <Spinner size={size === "sm" ? "sm" : "md"} color="current" aria-label="در حال انجام" />;
}
