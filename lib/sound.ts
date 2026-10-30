/** The one way the app makes a sound (F117). A screen calls `playSound("payment.saved")` with
 *  an event from EVENTS, never a sound name, so replacing a sound means editing the map below
 *  and nothing else. The sounds themselves are in lib/soundRecipes.ts.
 *
 *  Rules (docs/bencho-blocks-and-sounds.md):
 *  - On by default; each person can switch it off (`sound` in the preferences blob).
 *    Someone who asks the phone for reduced motion starts with it off until they switch it on.
 *  - The company owner picks the skin (bubble, mech or press) for everyone in the company.
 *    Before sign-in no company is known, so the plain skin plays.
 *  - iOS: the audio session is "ambient", so the ring/silent switch mutes it.
 *  - Never on high-frequency events: two sounds closer than GAP_MS keep only the first, and
 *    roam and wander (map panning) are listed but off.
 *  - Nothing plays in a hidden tab or before the first tap (browsers block audio until then). */

import { RECIPES, SKIN_SOUNDS, isSkin, type Layer, type Meaning, type Skin } from "./soundRecipes";

/** What an event plays: one of the 14 meanings in the company's skin, or one named sound. */
export type SoundCue = { meaning: Meaning } | { sound: string; off?: true };

/** Every event the app can sound. `area.event`; the comment is when it fires. */
export const EVENTS = {
  // The 14 meanings, played in the company's skin.
  "ui.tap": { meaning: "tap" }, // any button press
  "ui.type": { meaning: "type" }, // code boxes and the keypad only
  "ui.select": { meaning: "select" }, // a row picked, a chip chosen
  "ui.toggle": { meaning: "toggle" }, // a switch flipped
  "sheet.open": { meaning: "open" }, // a sheet or accordion opens
  "sheet.close": { meaning: "close" }, // a sheet closes
  "action.done": { meaning: "success" }, // an order, payment or task saved
  "action.failed": { meaning: "error" }, // a save or validation failed
  "nav.tab": { meaning: "navigate" }, // tab change
  "money.warning": { meaning: "warning" }, // below floor price, over credit limit
  "wait.long": { meaning: "loading" }, // a wait over one second
  "sync.ready": { meaning: "ready" }, // sync finished, data ready
  "notify.new": { meaning: "attention" }, // a new notification
  "number.count": { meaning: "count" }, // counter ticks, totals rolling

  // Money and the field day.
  "payment.saved": { sound: "paid" },
  "money.heavy": { sound: "thump" }, // large payment, closing a month
  "cash.added": { sound: "pouch" }, // cash added to «پول در دست»
  "stop.arrived": { sound: "landed" },
  "map.pin.dropped": { sound: "land" },
  "run.started": { sound: "stride" },
  "stop.visited": { sound: "mark" },
  "order.moved": { sound: "ferry" }, // to another day or route
  "visit.postponed": { sound: "punt" },
  "order.assigned": { sound: "hail" }, // a new order for a driver
  "order.ping": { sound: "perk" }, // live «سفارش تازه» for managers
  "target.reached": { sound: "crest" },
  "progress.step": { sound: "climb" },
  "figure.up": { sound: "rise" },
  "company.switched": { sound: "portal" },
  "app.opened": { sound: "boot" },
  "discount.requested": { sound: "knock" },
  "discount.refused": { sound: "snub" },
  "secure.passed": { sound: "latch" }, // authenticator code accepted
  "secure.saved": { sound: "vault" }, // bank details, documents
  "reminder.due": { sound: "bell" },
  "followup.nudge": { sound: "prod" },
  "alert.critical": { sound: "knell" }, // sync lost with unsent work
  "sync.failed": { sound: "groan" },
  "list.allDone": { sound: "sigh" },
  "clipboard.copied": { sound: "copied" },
  "doc.printed": { sound: "print" },
  "record.deleted": { sound: "trash" },
  "order.lineRemoved": { sound: "toss" },
  "photo.discarded": { sound: "crinkle" },
  "paper.tap": { sound: "paperTap" },
  "list.reordered": { sound: "rustle" },
  "drop.missed": { sound: "rim" },

  // Gestures and controls.
  "drag.grab": { sound: "drag" },
  "drag.lift": { sound: "lift" },
  "drag.hold": { sound: "grip" },
  "drag.release": { sound: "drop" },
  "slide.moving": { sound: "slide" },
  "message.sent": { sound: "swoop" },
  "refresh.done": { sound: "sweep" },
  "card.dismissed": { sound: "flick" },
  "row.swiped": { sound: "whisk" },
  "slider.snap": { sound: "notch" },
  "progress.fill": { sound: "fill" },
  "detail.expand": { sound: "expand" },
  "scroll.snap": { sound: "skim" },
  "pull.stretch": { sound: "strain" },
  "limit.reached": { sound: "bump" },
  "field.overLimit": { sound: "boing" },
  "pull.release": { sound: "twang" },
  "item.pinned": { sound: "pin" },
  "item.favourited": { sound: "pat" },
  "search.picked": { sound: "pick" },
  "checkbox.ticked": { sound: "check" },
  "chip.removed": { sound: "cross" },
  "stepper.step": { sound: "step" },
  "timer.tick": { sound: "tock" },
  "keypad.enter": { sound: "tamp" },
  "keypad.key": { sound: "peck" },
  "control.disabled": { sound: "poke" },
  "hold.start": { sound: "press" },
  "badge.shown": { sound: "pop" },
  "reaction.small": { sound: "bop" },
  "item.thrown": { sound: "arc" },
  "note.added": { sound: "dab" },
  "delete.pressed": { sound: "jab" },
  "swipe.armed": { sound: "cuff" },
  "locked.tried": { sound: "creak" },
  "month.closed.tapped": { sound: "stub" },
  "order.split": { sound: "chop" },

  // Moods and transitions: rare, big moments.
  "theme.dark": { sound: "lull" },
  "theme.light": { sound: "wake" },
  "sheet.full": { sound: "float" },
  "sheet.settle": { sound: "drape" },
  "page.transition": { sound: "glide" }, // wide screens only
  "toast.shown": { sound: "waft" },
  "toast.left": { sound: "slink" },
  "chart.hover": { sound: "hover" }, // desktop only
  "map.routeDrawn": { sound: "trail" },
  "tracking.started": { sound: "pulse" },
  "map.recentred": { sound: "swim" },
  "map.panned": { sound: "roam", off: true }, // far too frequent
  "map.wandered": { sound: "wander", off: true },
  "wait.veryLong": { sound: "creep" }, // over five seconds
  "sheet.snap": { sound: "sway" },
  "session.idleWarning": { sound: "idle" },
  "job.running": { sound: "drone" },
  "job.finished": { sound: "hum" },
  "draft.autosaved": { sound: "purr" },
  "field.invalid": { sound: "buzz" },
  "settings.saved": { sound: "cog" },
  "chip.changed": { sound: "shift" },
  "run.paused": { sound: "breath" },
  "sound.try": { sound: "tone" },
  "page.failed": { sound: "thud" },
} as const satisfies Record<string, SoundCue>;

export type SoundEvent = keyof typeof EVENTS;

/** The person's switch: "on", "off", or unset (the default, which is on). */
export type SoundSwitch = "on" | "off" | null;

/** Two sounds closer than this keep only the first: a toast and a check mark for one save are
 *  one sound, and a held key or a fast scroll cannot rattle. */
const GAP_MS = 60;

/** Which recipe an event plays for this skin; null for an event that is switched off.
 *  `skin` null means no company is known (signed out): the plain skin. */
export function soundFor(event: SoundEvent, skin: Skin | null): string | null {
  const cue: SoundCue = EVENTS[event];
  if ("meaning" in cue) return SKIN_SOUNDS[skin ?? "plain"][cue.meaning];
  return cue.off ? null : cue.sound;
}

/** Whether sound is on for this person: their own choice, else on, except that reduced motion
 *  starts it off. */
export function soundOn(choice: SoundSwitch, reducedMotion: boolean): boolean {
  return choice === null ? !reducedMotion : choice === "on";
}

/* ---------- Settings, kept for the next page load ---------- */

const STORE_KEY = "routeflow-sound";
let settings: { choice: SoundSwitch; skin: Skin | null } = { choice: null, skin: null };
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as { choice?: unknown; skin?: unknown } | null;
    settings = {
      choice: raw?.choice === "on" || raw?.choice === "off" ? raw.choice : null,
      skin: isSkin(raw?.skin) ? raw.skin : null,
    };
  } catch {
    /* private mode or a bad value: the defaults stand */
  }
}

/** Called by SoundSync with what the server says, and by the settings page after a change. */
export function configureSound(next: Partial<typeof settings>): void {
  load();
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* not saved for the next load; this page still uses it */
  }
}

function soundSettings(): { choice: SoundSwitch; skin: Skin | null } {
  load();
  return settings;
}

/* ---------- Playback ---------- */

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let lastAt = -Infinity;

/** Browsers start audio suspended until the person touches the page. The first real tap or key
 *  makes the context and resumes it; after that the listener goes away. */
function unlock() {
  if (ctx || typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    // "ambient" mixes with other audio and obeys the iPhone's silent switch (Safari 17+).
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "ambient";
    ctx = new AC();
    const master = ctx.createGain();
    // The recipes are mixed quiet (peaks near 0.05) so a stack of them stays clean; this lifts them
    // to a phone-speaker level and the compressor catches the rare pile-up.
    master.gain.value = 1.6;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    master.connect(limiter).connect(ctx.destination);
    out = master;
  } catch {
    ctx = null;
  }
}

if (typeof window !== "undefined") {
  const first = (e: Event) => {
    if (!e.isTrusted) return;
    unlock();
    void ctx?.resume();
    if (ctx) for (const t of ["pointerdown", "keydown"]) window.removeEventListener(t, first, true);
  };
  for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, first, true);
}

function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** Schedules `layers` on `c` from time `t0` (seconds). */
function schedule(c: BaseAudioContext, dest: AudioNode, layers: Layer[], t0: number): void {
  for (const l of layers) {
    const start = t0 + (l.at ?? 0) / 1000;
    const end = start + l.ms / 1000;
    const bendEnd = start + (l.bendMs ?? l.ms) / 1000;
    let source: AudioScheduledSourceNode;
    let head: AudioNode;
    let pitch: AudioParam;
    if (l.src === "noise") {
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c);
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = l.filter ?? "bandpass";
      f.Q.value = l.q ?? 1;
      s.connect(f);
      source = s;
      head = f;
      pitch = f.frequency;
    } else {
      const o = c.createOscillator();
      o.type = l.src;
      source = o;
      head = o;
      pitch = o.frequency;
      if (l.lp) {
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = l.lp;
        o.connect(f);
        head = f;
      }
    }
    pitch.setValueAtTime(l.hz, start);
    if (l.to) pitch.exponentialRampToValueAtTime(l.to, bendEnd);
    const env = c.createGain();
    const peakAt = start + Math.min(l.rise ?? 2, l.ms * 0.5) / 1000;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(l.vol, peakAt);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    head.connect(env).connect(dest);
    source.start(start);
    source.stop(end + 0.02);
  }
}

/** Plays the sound for `event`, if this person has sound on and the page can play. Never throws:
 *  a missed sound is better than a broken save. `force` is for the settings page's preview,
 *  which plays even while sound is off so the person can hear what they would switch on. */
export function playSound(event: SoundEvent, opts: { skin?: Skin | null; force?: boolean } = {}): void {
  if (typeof window === "undefined" || document.visibilityState === "hidden") return;
  const { choice, skin } = soundSettings();
  if (!opts.force && !soundOn(choice, matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const name = soundFor(event, opts.skin !== undefined ? opts.skin : skin);
  if (!name || !ctx || !out || ctx.state === "closed") return;
  // The first tap made the context a moment ago and its resume may still be settling.
  if (ctx.state !== "running") void ctx.resume();
  const now = performance.now();
  if (now - lastAt < GAP_MS) return;
  lastAt = now;
  try {
    schedule(ctx, out, RECIPES[name], ctx.currentTime + 0.005);
  } catch {
    /* an odd browser: stay quiet */
  }
}
