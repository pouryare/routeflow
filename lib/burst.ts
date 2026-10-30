import { buzz } from "@/lib/haptic";
import { playSound } from "@/lib/sound";

/** Puts `attr` on `el` for `ms`, restarting the CSS animation keyed on it: the attribute
 *  is taken off and put back with a reflow between, so a second tap while the first run
 *  is still going starts it again instead of being ignored. Returns a cancel. */
export function replay(el: HTMLElement, attr: string, ms: number): () => void {
  el.removeAttribute(attr);
  void el.offsetWidth;
  el.setAttribute(attr, "");
  const t = setTimeout(() => el.removeAttribute(attr), ms);
  return () => clearTimeout(t);
}

/** Plays the pop-and-burst on a `.burst` element: the icon pops, a ring and a few dots fly
 *  out, and the phone gives one short buzz and a small sound, so a tap that turned something ON is felt.
 *  Only for turning on (pin, star, favourite): turning off stays quiet. 600 ms is the
 *  longest of the CSS animations plus a frame. */
export function burst(el: HTMLElement): void {
  replay(el, "data-burst", 600);
  buzz(10);
  playSound("item.favourited");
}
