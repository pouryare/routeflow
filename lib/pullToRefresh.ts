const PULL_MAX = 96;
const PULL_TRIGGER = 64;

/** How far the indicator is drawn for a finger that has dragged `dy` px down: it follows at half speed
 *  and stops stretching at PULL_MAX, so the page feels held back. */
export function pullOffset(dy: number): number {
  return Math.max(0, Math.min(PULL_MAX, dy * 0.5));
}

/** Letting go refreshes only past this much pull. */
export function pullReady(offset: number): boolean {
  return offset >= PULL_TRIGGER;
}
