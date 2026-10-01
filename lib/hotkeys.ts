/** One answer to "what does this key do here?".
 *
 *  Sixteen components each add their own `keydown` listener today, and none of them is
 *  wrong. What is missing is a place where a binding is DECLARED, so two components claiming
 *  one key on one route becomes a reportable conflict instead of a race in which the second
 *  registration silently wins.
 *
 *  Pure by design — no DOM, no React. The provider that actually listens is a thin shell
 *  over this, which is what lets the conflict rules be tested in milliseconds.
 *
 *  `Mod` means Cmd on a Mac and Ctrl everywhere else, and is how a binding is written so the
 *  same line of copy works on both. Escape and Enter are deliberately absent: they belong to
 *  whichever dialog owns focus, and a registry that tried to own focus would break dialogs. */

export interface Binding {
  /** "K", "Mod+K", "Shift+/" — compared case-insensitively, modifiers in any order. */
  keys: string;
  description: string;
  /** Route prefixes this binding is live on. Empty means "everywhere". */
  routes: string[];
  /** Position in the cheatsheet. Lower first. */
  order: number;
  /** What the key does. ABSENT means documentation-only — that is how a binding that
   *  predates the registry (the map's own shortcuts, which still have their own working
   *  listeners) enters without claiming to be dispatched here. A registry that fired every
   *  documented key would double-handle the ones that already work. */
  run?: () => void;
}

/** Normalise a chord so "K", "k", "Ctrl+K" and "Shift+Ctrl+K" collide correctly.
 *
 *  Parts are SORTED so the same chord written in a different order is recognised as the same
 *  one — `Shift+Ctrl+K` and `Ctrl+Shift+K` are the same physical key press and reporting
 *  them as different would let a genuine double-binding through.
 *
 *  Nothing is DROPPED, which is why `Shift+K` does NOT collide with `K`: they are different
 *  keys, and a registry that collapsed them would match the wrong key at runtime. */
function chordOf(keys: string): string {
  const parts = keys
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => normaliseModifier(p))
    .sort();
  return parts.join("+");
}

/** Cmd, Ctrl and "Mod" are ONE chord.
 *
 *  The plan's normaliser mapped only `Mod`/`CmdOrCtrl` to `mod` and lower-cased the rest, so
 *  `Ctrl+K` became `ctrl+k` while `Mod+K` became `k+mod` — the plan's OWN test asserting they
 *  collide could never have passed. Cmd IS Ctrl as far as this registry is concerned: a
 *  binding that works on a Mac and not on Windows is not a binding, it is a platform bug. */
function normaliseModifier(part: string): string {
  const p = part.toLowerCase();
  if (p === "mod" || p === "cmdorctrl" || p === "cmd" || p === "ctrl" || p === "control" || p === "meta") {
    return "mod";
  }
  if (p === "option") return "alt";
  return p;
}

/** Is `route` inside the prefix `p`? An empty prefix matches everything. */
export function routeMatches(route: string, p: string): boolean {
  if (p === "") return true;
  if (p === "/") return route.startsWith("/");
  return route === p || route.startsWith(`${p}/`);
}

/** Do two bindings' route sets share at least one route?
 *
 *  Checked in BOTH directions. The plan only asked whether one prefix starts with the other
 *  AS WRITTEN, which misses the case that actually bites: `/sales` and `/sales/leads` are the
 *  same place to someone sitting on the leads page, and a binding scoped to each would be
 *  reported conflict-free while both listeners are live there. */
function routesOverlap(a: string[], b: string[]): boolean {
  const any = (x: string[]) => x.length === 0;
  if (any(a) || any(b)) return true;
  return a.some((r) => b.some((o) => routeMatches(r, o) || routeMatches(o, r)));
}

export function buildRegistry(bindings: readonly Binding[]): Binding[] {
  // A fresh array, so a caller mutating the result cannot reach back into the source.
  return [...bindings].sort((a, b) => a.order - b.order);
}

/** Every pair that claims the same chord on an overlapping route.
 *
 *  ALL pairs, not the first: three components binding one key on one route is two distinct
 *  conflicts, and reporting only the first hides how broken it is. */
export function conflicts(bindings: readonly Binding[]): Array<{ keys: string; routes: string[] }> {
  const out: Array<{ keys: string; routes: string[] }> = [];
  for (let i = 0; i < bindings.length; i += 1) {
    for (let j = i + 1; j < bindings.length; j += 1) {
      const a = bindings[i];
      const b = bindings[j];
      if (chordOf(a.keys) !== chordOf(b.keys)) continue;
      if (!routesOverlap(a.routes, b.routes)) continue;
      out.push({ keys: a.keys, routes: [...new Set([...a.routes, ...b.routes])] });
    }
  }
  return out;
}

/** The cheatsheet rows for one route, in reading order.
 *
 *  Derived from the registry so it cannot go stale the way a hand-kept list does — a
 *  shortcut that is not registered simply does not appear, which is the correct failure.
 *
 *  A child route's binding does NOT appear on its parent: promising a key on /sales that only
 *  works on /sales/leads is a broken promise, which is worse than an omission. */
export function helpRows(bindings: readonly Binding[], route: string): Binding[] {
  return buildRegistry(bindings)
    .filter((b) => b.routes.length === 0 || b.routes.some((r) => routeMatches(route, r)))
    .filter((b) => b.description.trim().length > 0);
}

/** Does this key event press this binding's chord?
 *
 *  The single place where a written chord meets a real `KeyboardEvent`, so the listener
 *  itself holds no logic. Kept separate from `chordOf` because that one normalises a
 *  DECLARATION and this one has to read the modifiers the browser actually reported.
 *
 *  Ctrl stands in for Cmd: browsers report `metaKey` on a Mac and `ctrlKey` elsewhere, and a
 *  registry that treated those as different chords would only work on one platform.
 *
 *  "?" is Shift+/ on most layouts, so either spelling of that character matches. */
export function eventMatchesChord(event: KeyboardEvent, keys: string): boolean {
  const wanted = keys
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => normaliseModifier(p));
  const key = (event.key ?? "").toLowerCase();
  const needsMod = wanted.includes("mod");
  const needsShift = wanted.includes("shift");
  const needsAlt = wanted.includes("alt") || wanted.includes("option");
  const hasMod = event.metaKey || event.ctrlKey;

  if (needsMod !== hasMod) return false;
  if (needsAlt !== event.altKey) return false;

  const bare = wanted.filter((p) => !["mod", "shift", "alt", "option"].includes(p));
  if (bare.length !== 1) return false;

  /* A SHIFTED CHARACTER REPORTS ITSELF ALREADY SHIFTED.
   *
   *  Pressing Shift+/ gives `key === "?"` AND `shiftKey === true`. So a binding written
   *  plainly as "?" must NOT also demand shift, or the most obvious help key in the app
   *  never fires.
   *
   *  Two spellings, two rules:
   *    "?"      — the character itself IS the key. Shift is already implied by the
   *               character, so it is not demanded. Pressing bare "/" does not match.
   *    "Shift+/"— "/" is not a shifted character, so shift is demanded exactly as written.
   *
   *  This handles "?" and "/" and nothing else, because those are the only two the app
   *  binds and the only case a browser reports this way. Generalising to every shifted
   *  character would be three times the code for a case no binding uses. */
  if (bare[0] === "?") {
    // Only fires when the user actually produced "?" — which means Shift was held.
    return key === "?";
  }
  if (bare[0] === "/" && needsShift) {
    return key === "/" || key === "?";
  }
  if (needsShift !== event.shiftKey) return false;
  return bare[0] === key;
}

/** Every binding the shell dispatches, plus the documented ones it does not.
 *
 *  Short, on purpose: this is a registry for the SHELL's own keys, not a migration of the
 *  sixteen listeners. Those keep working exactly as they do — Escape handling in a dialog is
 *  not this module's business, and removing a working listener without a replacement is how a
 *  dialog stops closing. */
export const BINDINGS: Binding[] = [];

/** The bindings this listener may actually fire. A documented-only binding has no `run`. */
export function runnableBindings(bindings: readonly Binding[]): Binding[] {
  return bindings.filter((b) => typeof b.run === "function");
}

/** The first binding live on `route` whose chord this event presses, or null.
 *
 *  `runnableBindings` first, so a documentation-only entry can never shadow a real one.
 *  That ordering is the whole point: the map's "?" is documented and the help dialog's "?"
 *  is real, and the real one must win. */
export function bindingFor(
  bindings: readonly Binding[],
  route: string,
  event: KeyboardEvent,
): Binding | null {
  const candidates = runnableBindings(bindings).filter(
    (b) => b.routes.length === 0 || b.routes.some((r) => routeMatches(route, r)),
  );
  return candidates.find((b) => eventMatchesChord(event, b.keys)) ?? null;
}

/** Is this event something the browser or an assistive technology owns?
 *
 *  Tab-and-modifier chords are left alone so focus movement keeps working, and anything with
 *  a modifier is passed through unless a binding explicitly claims it — a shortcut that eats
 *  a keystroke a screen reader needs is worse than a shortcut that does not fire. */
export function isReservedChord(event: KeyboardEvent): boolean {
  const key = (event.key ?? "").toLowerCase();
  if (key === "tab") return true;
  if (key === "escape" || key === "enter") return true;
  // F1..F12 are browser and OS shortcuts; hijacking one is never a kindness.
  if (/^f([1-9]|1[0-2])$/.test(key)) return true;
  return false;
}

/** Would this keystroke be swallowed by a text field?
 *
 *  The reason a shortcut that eats a typed character is worse than no shortcut: someone
 *  half-way through a customer's name presses K and the letter vanishes. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.isContentEditable === true;
}
