/** The 151 UI sounds, as data. Each sound is a few layers, and each layer is one oscillator or
 *  one burst of filtered noise with its own pitch, length and start time; lib/sound.ts turns
 *  them into Web Audio nodes. No audio files: a sound is a few hundred bytes of numbers.
 *
 *  The names and the job of each sound are from docs/bencho-blocks-and-sounds.md. bencho.dev
 *  states no licence, so these recipes are our own, written for the job each sound has here;
 *  only the idea (layers of tones and filtered noise, three "skins" of the same 14 meanings)
 *  is borrowed. Change a sound here; change which sound an action plays in lib/sound.ts. */

type Wave = "sine" | "triangle" | "square" | "sawtooth";

export interface Layer {
  /** An oscillator wave, or "noise" for a burst of filtered hiss. */
  src: Wave | "noise";
  /** Pitch in Hz; for noise, the filter's centre. */
  hz: number;
  /** Where the pitch (or centre) ends up, reached after `bendMs`. */
  to?: number;
  /** How long the bend takes; the whole layer when unset. */
  bendMs?: number;
  /** Length in ms, from start to silence. */
  ms: number;
  /** Peak level before the master volume. Noise needs more than a tone to sound as loud. */
  vol: number;
  /** Start, in ms after the sound begins. */
  at?: number;
  /** Fade-in, in ms. Short for clicks, long for pads. */
  rise?: number;
  /** Low-pass a tone at this frequency, to take the edge off square and triangle waves. */
  lp?: number;
  /** Noise only: the filter that shapes the hiss. */
  filter?: "bandpass" | "lowpass" | "highpass";
  /** Noise only: the filter's Q. Higher is a narrower, more pitched hiss. */
  q?: number;
}

/** Equal-tempered pitch from a note name: "A4" is 440, "C5" is middle C's octave up, "F#3"… */
export function note(name: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(`note: bad name ${name}`);
  const step = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as "C"];
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 440 * 2 ** ((step + accidental + (Number(m[3]) - 4) * 12) / 12);
}
const n = note;

type Opts = Partial<Omit<Layer, "src" | "hz" | "ms" | "vol">>;

const tone = (hz: number, ms: number, vol: number, o: Opts = {}): Layer => ({ src: "sine", hz, ms, vol, ...o });
const tri = (hz: number, ms: number, vol: number, o: Opts = {}): Layer => ({ src: "triangle", hz, ms, vol, lp: 1800, ...o });
const sq = (hz: number, ms: number, vol: number, o: Opts = {}): Layer => ({ src: "square", hz, ms, vol, lp: 1500, ...o });
const saw = (hz: number, ms: number, vol: number, o: Opts = {}): Layer => ({ src: "sawtooth", hz, ms, vol, lp: 900, ...o });
const glide = (from: number, to: number, ms: number, vol: number, o: Opts = {}): Layer => tone(from, ms, vol, { to, ...o });
/** A band of hiss: a click when short and narrow, a rustle when long and wide. */
const hiss = (hz: number, ms: number, vol: number, o: Opts = {}): Layer => ({ src: "noise", hz, ms, vol, filter: "bandpass", q: 2, rise: 1, ...o });
/** Dull, low hiss: a puff of air, cloth, a soft landing. */
const puff = (hz: number, ms: number, vol: number, o: Opts = {}): Layer => ({ src: "noise", hz, ms, vol, filter: "lowpass", q: 0.7, rise: 2, ...o });

/** A small struck bell: the note, a quieter octave that dies sooner, a faint twelfth, and a tick
 *  for the strike. Used for anything that says "done" or "look". */
function bell(hz: number, ms: number, vol: number, at = 0): Layer[] {
  return [
    hiss(Math.min(hz * 4, 7000), 4, vol * 2, { at, q: 1.2 }),
    tone(hz, ms, vol, { at, rise: 2 }),
    tone(hz * 2, ms * 0.55, vol * 0.3, { at, rise: 2 }),
    tone(hz * 3, ms * 0.3, vol * 0.1, { at, rise: 2 }),
  ];
}

/** Notes one after another, `gap` ms apart. */
function run(notes: string[], gap: number, ms: number, vol: number, wave: "sine" | "triangle" = "sine"): Layer[] {
  return notes.map((name, i) => (wave === "sine" ? tone : tri)(n(name), ms, vol, { at: i * gap, rise: 3 }));
}

/** A dull thud with a body: a low tone falling a little, plus a short low puff for the contact. */
function knock(hz: number, ms: number, vol: number, at = 0): Layer[] {
  return [tone(hz, ms, vol, { to: hz * 0.7, at, rise: 2 }), puff(900, Math.min(30, ms), vol * 0.8, { at })];
}

/* ---------- The 14 meanings in four skins ---------- */

/** The 14 things a control can say. Each skin says all of them in its own voice. */
export const MEANINGS = [
  "tap", "type", "select", "toggle", "open", "close", "success",
  "error", "navigate", "warning", "loading", "ready", "attention", "count",
] as const;
export type Meaning = (typeof MEANINGS)[number];

/** The skins a company owner can choose (company settings). "plain" is not one of them: it plays
 *  before sign-in, when no company is known yet. */
export const SKINS = ["bubble", "mech", "press"] as const;
export type Skin = (typeof SKINS)[number];
export const DEFAULT_SKIN: Skin = "bubble";
export const SKIN_LABELS: Record<Skin, string> = { bubble: "حباب", mech: "مکانیکی", press: "کلید" };
export const isSkin = (v: unknown): v is Skin => typeof v === "string" && (SKINS as readonly string[]).includes(v);

/** Which recipe each meaning plays in each skin. The plain names are the original short ones. */
export const SKIN_SOUNDS: Record<Skin | "plain", Record<Meaning, string>> = {
  plain: {
    tap: "click", type: "type", select: "select", toggle: "off", open: "open", close: "close", success: "chime",
    error: "deny", navigate: "navigate", warning: "warning", loading: "loading", ready: "ready", attention: "attention", count: "count",
  },
  mech: Object.fromEntries(MEANINGS.map((m) => [m, `mech${m[0].toUpperCase()}${m.slice(1)}`])) as Record<Meaning, string>,
  bubble: Object.fromEntries(MEANINGS.map((m) => [m, `bubble${m[0].toUpperCase()}${m.slice(1)}`])) as Record<Meaning, string>,
  press: Object.fromEntries(MEANINGS.map((m) => [m, `press${m[0].toUpperCase()}${m.slice(1)}`])) as Record<Meaning, string>,
};

/** Plain: soft sine tones, nothing mechanical. */
const PLAIN: Record<string, Layer[]> = {
  click: [glide(520, 360, 40, 0.07, { rise: 1 })],
  type: [glide(900, 700, 18, 0.045, { rise: 1 }), hiss(3200, 6, 0.08)],
  select: [glide(600, 820, 45, 0.06, { rise: 2 })],
  off: [glide(440, 300, 80, 0.05, { rise: 3 })],
  open: [glide(330, 520, 150, 0.05, { rise: 40 }), tone(n("E5"), 160, 0.012, { at: 60, rise: 20 })],
  close: [glide(520, 300, 120, 0.05, { rise: 6 })],
  chime: [...bell(n("G5"), 420, 0.045), ...bell(n("C6"), 520, 0.04, 110)],
  deny: [glide(n("D4"), n("B3"), 160, 0.06, { rise: 4 }), glide(n("B3"), n("G3"), 180, 0.05, { at: 140, rise: 4 })],
  navigate: [hiss(700, 160, 0.12, { to: 2000, q: 1.1, rise: 70 }), glide(400, 640, 120, 0.02, { rise: 50 })],
  warning: [...bell(n("A4"), 200, 0.04), ...bell(n("A4"), 240, 0.035, 190)],
  loading: [tone(n("G3"), 1100, 0.02, { rise: 380 }), tone(n("D4"), 1000, 0.008, { rise: 400, at: 60 })],
  ready: [...bell(n("D5"), 360, 0.04), tone(n("G5"), 300, 0.03, { at: 90, rise: 3 })],
  attention: [...bell(n("B5"), 420, 0.04), ...bell(n("E6"), 520, 0.03, 150)],
  count: run(["C5", "D5", "E5", "F5", "G5", "A5"], 55, 60, 0.035),
};

/** Mech: a plastic switch. A bright, narrow tick for the contact, a lower one for the housing, and
 *  a short square-ish tone where the meaning needs a pitch. */
function mechClick(hi: number, lo: number, vol = 1, at = 0): Layer[] {
  return [hiss(hi, 4, 0.35 * vol, { q: 3, at }), hiss(lo, 9, 0.45 * vol, { q: 5, at })];
}
const MECH: Record<string, Layer[]> = {
  mechTap: [...mechClick(3800, 1700), sq(600, 14, 0.02, { to: 420 })],
  mechType: [...mechClick(4400, 2300, 0.7), hiss(900, 8, 0.2, { q: 3 })],
  mechSelect: [...mechClick(4200, 1900), sq(1250, 30, 0.012)],
  mechToggle: [...mechClick(3400, 1500), ...mechClick(2800, 1300, 0.8, 55)],
  mechOpen: [...mechClick(3000, 1400), hiss(1000, 60, 0.2, { to: 2600, q: 2, rise: 20 })],
  mechClose: [hiss(2600, 50, 0.16, { to: 1000, q: 2, rise: 15 }), ...mechClick(2200, 950, 1.1, 45)],
  mechSuccess: [...mechClick(3600, 1600, 0.8), sq(n("E5"), 90, 0.018, { at: 10 }), sq(n("A5"), 140, 0.016, { at: 85 })],
  mechError: [...mechClick(1600, 500, 1.2), sq(n("C4"), 80, 0.03, { at: 5 }), sq(n("A3"), 110, 0.028, { at: 80 })],
  mechNavigate: [hiss(900, 120, 0.22, { to: 1900, q: 2, rise: 45 }), ...mechClick(3600, 1800, 0.8, 110)],
  mechWarning: [...mechClick(3000, 1400, 0.7), sq(n("F5"), 80, 0.018, { at: 10 }), sq(n("F5"), 90, 0.018, { at: 130 })],
  mechLoading: [hiss(700, 1100, 0.04, { q: 1.4, rise: 380 }), tone(n("Bb3"), 1150, 0.012, { rise: 400 })],
  mechReady: [...mechClick(3600, 1700, 0.8), sq(n("C5"), 150, 0.02, { at: 8 }), tone(n("G5"), 120, 0.008, { at: 8 })],
  mechAttention: [...mechClick(3600, 1700, 0.8), sq(n("A5"), 160, 0.016, { at: 8 }), sq(n("D6"), 200, 0.013, { at: 150 })],
  mechCount: [0, 60, 120, 180, 240, 300].flatMap((t, i) => mechClick(2600 + i * 220, 1300 + i * 120, 0.6, t)),
};

/** Bubble: water drops. Every layer is a sine sliding in pitch, with a soft puff where a drop would
 *  land. Round and quiet, which is why it is the default. */
const BUBBLE: Record<string, Layer[]> = {
  bubbleTap: [glide(640, 380, 30, 0.07, { rise: 1 }), glide(760, 1000, 40, 0.012, { rise: 8 })],
  bubbleType: [glide(760, 520, 18, 0.055, { rise: 1 }), puff(2400, 5, 0.04)],
  bubbleSelect: [glide(560, 900, 32, 0.06, { rise: 1 }), puff(2800, 5, 0.04)],
  bubbleToggle: [glide(380, 600, 50, 0.045, { rise: 2 }), glide(600, 880, 45, 0.03, { at: 45, rise: 2 })],
  bubbleOpen: [glide(260, 600, 170, 0.035, { rise: 70 }), glide(390, 900, 180, 0.01, { rise: 70 })],
  bubbleClose: [glide(680, 240, 100, 0.05, { rise: 3 }), puff(1300, 6, 0.06, { at: 85 })],
  bubbleSuccess: [glide(n("C5"), n("E5"), 70, 0.055, { rise: 2, bendMs: 50 }), glide(n("E5"), n("G5"), 260, 0.05, { at: 75, rise: 2, bendMs: 60 }), tone(n("G6"), 140, 0.008, { at: 80 })],
  bubbleError: [glide(n("E4"), n("C4"), 170, 0.055, { rise: 3 }), glide(n("C4"), n("A3"), 200, 0.045, { at: 130, rise: 3 }), puff(900, 6, 0.1)],
  bubbleNavigate: [glide(340, 1300, 90, 0.045, { rise: 8 }), hiss(1600, 90, 0.05, { to: 3200, q: 1, rise: 20 })],
  bubbleWarning: [glide(n("A4"), n("G#4"), 130, 0.05, { rise: 2 }), glide(n("A4"), n("G#4"), 150, 0.045, { at: 160, rise: 2 })],
  bubbleLoading: [glide(380, 560, 1200, 0.014, { rise: 400 }), puff(1000, 1000, 0.016, { rise: 380 })],
  bubbleReady: [glide(1300, 700, 14, 0.04, { rise: 1 }), glide(n("G4"), n("C5"), 280, 0.055, { at: 20, rise: 8, bendMs: 70 })],
  bubbleAttention: [glide(n("E5"), n("A5"), 120, 0.06, { rise: 2, bendMs: 80 }), glide(n("A5"), n("C#6"), 220, 0.04, { at: 150, rise: 2, bendMs: 80 })],
  bubbleCount: [0, 65, 130, 195, 260, 325].map((t, i) => glide(500 + i * 70, 760 + i * 90, 40, 0.04, { at: t, rise: 1 })),
};

/** Press: a deep keyboard key. A crisp top tick, a low wooden body, and a quieter tick when the key
 *  comes back up 80 ms later. Pitched meanings ring a soft low chord under the key. */
function key(body = 190, vol = 1, at = 0): Layer[] {
  return [
    hiss(4200, 6, 0.12 * vol, { q: 6, at }),
    tri(body, 60, 0.05 * vol, { to: body * 0.85, lp: 700, at, rise: 2 }),
    hiss(3600, 5, 0.06 * vol, { q: 6, at: at + 80 }),
  ];
}
const pad = (names: string[], ms: number, vol: number, at = 20): Layer[] =>
  names.map((name, i) => tone(n(name), ms - i * 60, vol * (1 - i * 0.2), { at, rise: 60 }));
const PRESS: Record<string, Layer[]> = {
  pressTap: key(180),
  pressType: [...key(230, 0.8), glide(500, 330, 22, 0.02, { rise: 1 })],
  pressSelect: [...key(210), glide(1000, 760, 22, 0.018, { rise: 1 })],
  pressToggle: [...key(200), ...key(160, 0.7, 110)],
  pressOpen: [...key(190), hiss(1500, 50, 0.04, { to: 3000, q: 1.5, rise: 10 }), ...pad(["A3", "E4"], 600, 0.014)],
  pressClose: [hiss(1900, 50, 0.04, { to: 800, q: 1.5, rise: 10 }), ...key(150, 1.1, 30)],
  pressSuccess: [...key(200), ...pad(["C4", "E4", "G4", "C5"], 1100, 0.016)],
  pressError: [...key(140, 1.2), ...pad(["A3", "C4"], 520, 0.018), puff(240, 70, 0.05)],
  pressNavigate: [...key(220), hiss(700, 90, 0.12, { to: 1600, q: 1, rise: 10 })],
  pressWarning: [...key(180), ...pad(["E4", "A4"], 800, 0.015)],
  pressLoading: [tone(n("G3"), 1200, 0.016, { rise: 400 }), tone(n("D4"), 1100, 0.006, { rise: 420 })],
  pressReady: [...key(190), ...pad(["G3", "D4", "G4"], 1300, 0.018)],
  pressAttention: [...key(210), ...pad(["A4", "E5", "A5"], 1500, 0.017)],
  pressCount: [0, 70, 140, 210, 280, 350].flatMap((t, i) => key(170 + i * 18, 0.6, t)),
};

/* ---------- Sounds with one job each ---------- */

const MONEY: Record<string, Layer[]> = {
  // Two bright bells and a coin glint: the one sound everybody should learn.
  paid: [...bell(n("E6"), 260, 0.035), ...bell(n("B6"), 520, 0.032, 90), hiss(6500, 120, 0.02, { at: 95, q: 3 })],
  thump: [...knock(110, 220, 0.075), tone(n("C3"), 400, 0.03, { at: 10, rise: 6 })],
  pouch: [puff(800, 40, 0.09), hiss(5200, 12, 0.03, { at: 20, q: 4 }), hiss(4600, 12, 0.025, { at: 48, q: 4 })],
  landed: [...run(["G5", "C6", "E6"], 75, 140, 0.035), ...bell(n("G6"), 520, 0.03, 225)],
  land: [glide(520, 300, 90, 0.04, { rise: 2 }), puff(700, 40, 0.07, { at: 70 })],
  stride: [tri(n("D4"), 120, 0.035, { rise: 8 }), tri(n("A4"), 220, 0.035, { at: 110, rise: 8 })],
  mark: [sq(n("A4"), 24, 0.03), hiss(3000, 5, 0.1, { q: 3 })],
  ferry: [glide(380, 560, 160, 0.04, { rise: 30 }), glide(560, 420, 160, 0.03, { at: 150, rise: 10 })],
  punt: [glide(440, 330, 110, 0.045, { rise: 5 }), tone(330, 140, 0.02, { at: 120, rise: 10 })],
  hail: [...bell(n("D6"), 300, 0.035), ...bell(n("A5"), 380, 0.03, 130)],
  perk: [...bell(n("A5"), 240, 0.04), ...bell(n("E6"), 300, 0.035, 100), ...bell(n("A6"), 420, 0.025, 200)],
  crest: [...run(["C5", "E5", "G5", "C6"], 85, 200, 0.035, "triangle"), ...bell(n("E6"), 700, 0.025, 340)],
  climb: run(["E5", "G5", "B5"], 60, 110, 0.035),
  rise: [glide(n("C5"), n("G5"), 200, 0.04, { rise: 8 })],
  portal: [glide(300, 900, 220, 0.03, { rise: 60 }), hiss(1200, 220, 0.04, { to: 4000, q: 1, rise: 60 }), tone(n("E5"), 200, 0.02, { at: 220 })],
  boot: [tone(n("C4"), 600, 0.02, { rise: 160 }), tone(n("G4"), 520, 0.018, { at: 120, rise: 140 }), tone(n("C5"), 480, 0.016, { at: 240, rise: 120 })],
  knock: [...knock(300, 50, 0.06), ...knock(300, 60, 0.055, 120)],
  snub: [tri(n("E4"), 60, 0.04), tri(n("C4"), 110, 0.04, { at: 70 })],
  latch: [hiss(2500, 6, 0.2, { q: 4 }), sq(n("C5"), 40, 0.025, { at: 3 }), hiss(1700, 8, 0.22, { q: 5, at: 60 })],
  vault: [...knock(90, 260, 0.07), hiss(1400, 12, 0.18, { q: 5, at: 150 }), tone(n("G2"), 400, 0.03, { at: 150, rise: 8 })],
  bell: [...bell(n("G5"), 700, 0.04), ...bell(n("G5"), 700, 0.03, 380)],
  prod: [tri(n("B4"), 40, 0.04), tri(n("B4"), 40, 0.035, { at: 90 })],
  knell: [...bell(n("D4"), 1000, 0.05), ...bell(n("A3"), 1100, 0.045, 420)],
  groan: [glide(n("A4"), n("D4"), 260, 0.045, { rise: 15 })],
  sigh: [puff(1200, 320, 0.04, { to: 500, rise: 80 }), glide(n("A4"), n("F4"), 300, 0.02, { rise: 70 })],
  copied: [tone(n("A5"), 60, 0.03, { rise: 2 }), tone(n("E6"), 140, 0.026, { at: 50, rise: 2 })],
  print: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180].map((t, i) => hiss(4600 + (i % 3) * 400, 6, 0.14, { at: t, q: 4 })),
  trash: [puff(600, 80, 0.12), hiss(2200, 25, 0.04, { at: 5 })],
  toss: [hiss(1200, 150, 0.1, { to: 500, q: 0.9, rise: 40 })],
  crinkle: [0, 30, 55, 85, 110].map((t, i) => hiss(2800 + (i % 2) * 900, 20, 0.13, { at: t, q: 2.5 })),
  paperTap: [puff(1500, 30, 0.1, { q: 0.5 })],
  rustle: [hiss(3200, 90, 0.04, { q: 1.2, rise: 30 }), hiss(2400, 70, 0.03, { at: 60, q: 1.2, rise: 20 })],
  rim: [hiss(900, 30, 0.22, { q: 4 }), puff(450, 50, 0.1, { at: 10 })],
};

const GESTURE: Record<string, Layer[]> = {
  drag: [tone(190, 220, 0.03, { to: 170, rise: 30, lp: 700 })],
  lift: [glide(620, 760, 40, 0.03, { rise: 3 })],
  grip: [tone(300, 35, 0.05, { rise: 3, lp: 1200 }), puff(1200, 10, 0.04)],
  drop: [glide(240, 150, 120, 0.065, { rise: 2 }), puff(600, 30, 0.06, { at: 5 })],
  slide: [hiss(600, 300, 0.08, { to: 1400, q: 1.5, rise: 90 })],
  swoop: [glide(300, 1100, 140, 0.035, { rise: 20 }), hiss(2000, 120, 0.04, { to: 5000, q: 1, rise: 30 })],
  sweep: [hiss(3000, 220, 0.05, { to: 900, q: 1.2, rise: 50 }), tone(n("E5"), 120, 0.02, { at: 200, rise: 3 })],
  flick: [hiss(2600, 30, 0.14, { to: 4400, q: 1.5 })],
  whisk: [hiss(1800, 110, 0.09, { to: 700, q: 1.3, rise: 25 })],
  notch: [tri(260, 40, 0.045, { rise: 2 }), hiss(2800, 4, 0.1, { q: 4 })],
  fill: [glide(300, 600, 200, 0.03, { rise: 60 })],
  expand: [glide(220, 330, 260, 0.035, { rise: 40 }), glide(330, 500, 220, 0.012, { at: 30, rise: 40 })],
  skim: [hiss(2000, 60, 0.04, { q: 2, rise: 10 }), tone(500, 40, 0.02, { at: 40 })],
  strain: [saw(260, 120, 0.035, { to: 240, rise: 15 })],
  bump: [...knock(140, 120, 0.08), tri(380, 25, 0.015)],
  boing: [glide(240, 460, 60, 0.045, { rise: 3, bendMs: 35 }), glide(460, 330, 70, 0.025, { at: 45, rise: 3 })],
  twang: [hiss(2400, 12, 0.05, { q: 2 }), tri(160, 240, 0.08, { to: 100, bendMs: 140, lp: 2200 }), tone(320, 120, 0.02, { to: 210, at: 5 })],
  pin: [tri(n("E5"), 40, 0.04, { rise: 2 }), hiss(4000, 5, 0.08, { q: 3 })],
  pat: [glide(500, 800, 50, 0.045, { rise: 2 }), tone(n("B5"), 120, 0.02, { at: 40, rise: 2 })],
  pick: [sq(280, 30, 0.035, { rise: 2 }), hiss(2600, 5, 0.1, { q: 3 })],
  check: [sq(n("F#4"), 30, 0.03, { rise: 2 }), sq(n("C#5"), 70, 0.03, { at: 35, rise: 2 })],
  cross: [glide(200, 110, 160, 0.05, { rise: 5 })],
  step: [tri(300, 35, 0.04, { rise: 2 }), hiss(3200, 4, 0.07, { q: 3 })],
  tock: [tri(270, 22, 0.045, { rise: 2, lp: 1500 }), hiss(1800, 6, 0.08, { q: 4 })],
  tamp: [tri(230, 70, 0.05, { rise: 3, to: 200 }), puff(900, 20, 0.05)],
  peck: [tri(320, 25, 0.05, { rise: 1 }), hiss(2400, 5, 0.09, { q: 3 })],
  poke: [tri(420, 20, 0.04, { rise: 1 }), tri(420, 20, 0.03, { at: 70, rise: 1 })],
  press: [tone(160, 110, 0.03, { rise: 20, lp: 500 })],
  pop: [glide(600, 1000, 35, 0.05, { rise: 2 })],
  bop: [glide(300, 420, 40, 0.05, { rise: 2 })],
  arc: [glide(400, 900, 120, 0.035, { rise: 20, bendMs: 70 }), glide(900, 260, 140, 0.035, { at: 100, rise: 5 })],
  dab: [tri(250, 30, 0.045, { rise: 3 }), puff(1400, 12, 0.04)],
  jab: [sq(240, 30, 0.04, { rise: 2 }), hiss(1500, 8, 0.12, { q: 3 })],
  cuff: [tri(260, 28, 0.055, { rise: 2 }), hiss(1200, 10, 0.1, { q: 3 })],
  creak: [saw(200, 140, 0.03, { to: 240, rise: 20 }), hiss(1900, 10, 0.03, { at: 60, q: 3 })],
  stub: [tri(220, 30, 0.05, { rise: 3 }), puff(500, 30, 0.06)],
  chop: [hiss(1600, 20, 0.15, { q: 2 }), tri(300, 50, 0.04, { rise: 2, to: 220 })],
};

/** Mood and ambient sounds: rare, big moments only, so they may be longer and lower. */
const MOOD: Record<string, Layer[]> = {
  lull: [glide(n("E4"), n("B3"), 380, 0.04, { rise: 40 }), tone(n("G3"), 420, 0.02, { at: 60, rise: 60 })],
  wake: [glide(n("B3"), n("E4"), 300, 0.035, { rise: 40 }), tone(n("B4"), 380, 0.02, { at: 120, rise: 40 })],
  float: [glide(260, 400, 300, 0.035, { rise: 90 })],
  drape: [glide(320, 220, 260, 0.04, { rise: 20 })],
  glide: [glide(420, 300, 220, 0.04, { rise: 60 })],
  waft: [glide(330, 440, 240, 0.03, { rise: 70, lp: 1100 }), puff(1400, 180, 0.015, { rise: 60 })],
  slink: [glide(400, 260, 240, 0.03, { rise: 30, lp: 1100 })],
  hover: [tone(260, 140, 0.015, { rise: 40 })],
  trail: [glide(260, 390, 380, 0.025, { rise: 40, lp: 1500 })],
  pulse: [tone(120, 260, 0.05, { rise: 60 }), tone(120, 260, 0.04, { at: 330, rise: 60 })],
  swim: [glide(140, 200, 200, 0.045, { rise: 50 })],
  roam: [glide(380, 420, 200, 0.03, { rise: 30 })],
  wander: [glide(330, 300, 220, 0.03, { rise: 40 })],
  creep: [tone(400, 420, 0.025, { rise: 120 }), tone(404, 420, 0.02, { rise: 120 })],
  sway: [glide(420, 380, 160, 0.035, { rise: 10, to: 380 }), glide(380, 420, 140, 0.025, { at: 140, rise: 10 })],
  idle: [glide(n("C4"), n("C3"), 420, 0.045, { rise: 80 })],
  drone: [tone(110, 420, 0.05, { rise: 100 }), tone(165, 400, 0.015, { rise: 120 })],
  hum: [tone(n("G3"), 340, 0.045, { rise: 80 }), tone(n("D4"), 300, 0.015, { rise: 90 })],
  purr: [tri(95, 320, 0.05, { rise: 40, lp: 900 })],
  buzz: [tri(340, 30, 0.05, { to: 240, rise: 5 }), tri(340, 30, 0.04, { at: 50, to: 240, rise: 5 })],
  cog: [tone(420, 28, 0.06, { rise: 4, lp: 1200 }), hiss(2600, 5, 0.08, { q: 3, at: 25 })],
  shift: [glide(340, 260, 140, 0.04, { rise: 20 })],
  breath: [puff(1500, 600, 0.03, { rise: 260 })],
  tone: [...bell(n("C5"), 500, 0.045)],
  thud: [...knock(110, 180, 0.08), puff(600, 60, 0.05, { at: 5 })],
};

/** Every sound by name: 56 meaning sounds (four skins of 14) and 95 with one job each. */
export const RECIPES: Record<string, Layer[]> = { ...PLAIN, ...MECH, ...BUBBLE, ...PRESS, ...MONEY, ...GESTURE, ...MOOD };

/** Longest sound end, in ms. */
export const lengthOf = (layers: Layer[]): number => Math.max(...layers.map((l) => (l.at ?? 0) + l.ms));
