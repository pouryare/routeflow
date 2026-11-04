"use client";

import { Icon } from "@/components/meridian/Icon";
import { burst } from "@/lib/burst";

/** The heart on a customer card: tap to mark it a favourite (it bursts), tap again to take it off. The
 *  list itself lives with the screen that shows the cards (`useFavourites`). */
export default function FavouriteHeart({ on, name, onToggle }: { on: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`burst touch favheart${on ? " favheart--on" : ""}`}
      aria-pressed={on}
      aria-label={`دلخواه: ${name}`}
      onClick={(e) => {
        if (!on) burst(e.currentTarget);
        onToggle();
      }}
    >
      <Icon name="heart" size="md" filled={on} />
    </button>
  );
}
