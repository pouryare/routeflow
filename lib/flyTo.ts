/** Fly-to (owner, 2026-11-05): a thing that just went somewhere shrinks to a dot and flies along a
 *  curve into where it went -- a closing message into the bell, work saved offline into the sync
 *  icon, a new order into the orders tab. The target is any visible `[data-fly-target~="name"]`;
 *  when it lands the target gets `data-landed` for a short pop.
 *
 *  Off (nothing flies, the promise settles at once) when effects are off (`html[data-fx="off"]`,
 *  see components/FxSync.tsx), under reduced motion, or when no target is on screen. */

export interface Point {
  x: number;
  y: number;
}

/** Points along a curve from `a` to `b` that rises above both ends first, so the dot arcs
 *  instead of sliding in a straight line. `n` steps, both ends included. Pure. */
export function arc(a: Point, b: Point, n = 12): Point[] {
  const lift = Math.max(40, Math.abs(b.x - a.x) * 0.35);
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

/* Where the last tap ended: the start point when the caller has no element to fly from. */
let lastTap: Point | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerup", (e) => (lastTap = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
}

function centre(r: DOMRect): Point {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function canFly(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.fx !== "off" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-fly-target~="${CSS.escape(name)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const FLIGHT_MS = 560;

/** Flies a dot from `from` (an element, a box, or the last tap when left out) into the target.
 *  Resolves true when it landed, false when nothing flew. */
export function flyTo(target: string, from?: Element | DOMRect | null): Promise<boolean> {
  if (!canFly()) return Promise.resolve(false);
  const to = findTarget(target);
  const start = from instanceof Element ? centre(from.getBoundingClientRect()) : from ? centre(from) : lastTap;
  if (!to || !start) return Promise.resolve(false);
  const end = centre(to.getBoundingClientRect());
  const dot = document.createElement("div");
  dot.className = "flydot";
  dot.setAttribute("aria-hidden", "true");
  document.body.appendChild(dot);
  const pts = arc(start, end);
  const frames = pts.map((p, i) => ({
    transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${1 - (0.6 * i) / (pts.length - 1)})`,
    opacity: i === pts.length - 1 ? 0.4 : 1,
  }));
  const anim = dot.animate(frames, { duration: FLIGHT_MS, easing: "cubic-bezier(.5,0,.75,0)" });
  return anim.finished
    .catch(() => undefined)
    .then(() => {
      dot.remove();
      to.removeAttribute("data-landed");
      void to.offsetWidth;
      to.setAttribute("data-landed", "");
      window.setTimeout(() => to.removeAttribute("data-landed"), 420);
      return true;
    });
}
