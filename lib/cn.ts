import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Every new kargah component builds its className with this: clsx's conditional
 *  joining, then tailwind-merge to resolve conflicting utility classes so a caller's
 *  override always wins over the component's own default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
