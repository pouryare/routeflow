import { buzz } from "@/lib/haptic";

/** How long the pop and burst run (globals.css `.burst`), plus a frame of slack. */
const BURST_MS = 600;

/** Plays the pop-and-burst on a `.burst` element: the icon pops, a ring and a few dots fly
 *  out, and the phone gives one short buzz, so a tap that turned something ON is felt.
 *  Only for turning on (pin, star, favourite): turning off stays quiet.
 *
 *  The attribute is taken off and put back with a reflow between, so a second tap while
 *  the first burst is still running starts it again instead of being ignored. */
export function burst(el: HTMLElement): void {
  el.removeAttribute("data-burst");
  void el.offsetWidth;
  el.setAttribute("data-burst", "");
  buzz(10);
  setTimeout(() => el.removeAttribute("data-burst"), BURST_MS);
}
