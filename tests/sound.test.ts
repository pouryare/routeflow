import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EVENTS, soundFor, soundOn, type SoundEvent } from "@/lib/sound";
import { MEANINGS, RECIPES, SKINS, SKIN_SOUNDS, isSkin, lengthOf, note } from "@/lib/soundRecipes";

/** The sound names in docs/bencho-blocks-and-sounds.md, read from its tables: the meaning table
 *  has four sound columns, the others one cell that may list several names. */
function namesInDoc(): string[] {
  const doc = readFileSync(path.resolve(__dirname, "../docs/bencho-blocks-and-sounds.md"), "utf8");
  const part = doc.slice(doc.indexOf("## Sounds: all 151"), doc.indexOf("## Gaps"));
  return part.split("\n").flatMap((line) => {
    if (!line.startsWith("|") || line.startsWith("|---")) return [];
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells[0] === "Meaning" || cells[0] === "Sound") return [];
    return cells.length === 6 ? cells.slice(1, 5) : cells[0].split(",").map((n) => n.trim());
  });
}

describe("sound recipes", () => {
  it("has exactly the 151 sounds the sound sheet lists", () => {
    const doc = namesInDoc();
    expect(doc).toHaveLength(151);
    expect(Object.keys(RECIPES).sort()).toEqual([...doc].sort());
  });

  it("keeps every layer within what a phone speaker and the ear can take", () => {
    for (const [name, layers] of Object.entries(RECIPES)) {
      expect(layers.length, name).toBeGreaterThan(0);
      for (const l of layers) {
        expect(l.ms, name).toBeGreaterThan(0);
        expect(l.vol, name).toBeGreaterThan(0);
        expect(l.vol, name).toBeLessThanOrEqual(0.45);
        expect(l.hz, name).toBeGreaterThanOrEqual(40);
        expect(l.hz, name).toBeLessThanOrEqual(12000);
        if (l.to !== undefined) expect(l.to, name).toBeGreaterThan(0);
      }
      // Pads may ring; nothing may hang on for seconds.
      expect(lengthOf(layers), name).toBeLessThanOrEqual(1700);
    }
  });

  it("reads note names in equal temperament", () => {
    expect(note("A4")).toBe(440);
    expect(note("A5")).toBe(880);
    expect(note("C5")).toBeCloseTo(523.25, 1);
    expect(note("F#3")).toBeCloseTo(185, 0);
    expect(() => note("H2")).toThrow();
  });
});

describe("skins", () => {
  it("gives every skin all 14 meanings, each its own recipe", () => {
    for (const skin of [...SKINS, "plain"] as const) {
      const names = MEANINGS.map((m) => SKIN_SOUNDS[skin][m]);
      expect(new Set(names).size, skin).toBe(14);
      for (const n of names) expect(RECIPES[n], `${skin}: ${n}`).toBeDefined();
    }
  });

  it("knows its skin names", () => {
    expect(isSkin("bubble")).toBe(true);
    expect(isSkin("plain")).toBe(false);
    expect(isSkin(undefined)).toBe(false);
  });
});

describe("event map", () => {
  const events = Object.keys(EVENTS) as SoundEvent[];

  it("points every event at a real sound", () => {
    for (const e of events) {
      const cue = EVENTS[e] as { sound?: string };
      if (cue.sound) expect(RECIPES[cue.sound], e).toBeDefined();
    }
  });

  it("gives all 151 sounds a job", () => {
    const used = new Set<string>();
    for (const e of events) {
      const cue = EVENTS[e] as { sound?: string; meaning?: (typeof MEANINGS)[number] };
      if (cue.sound) used.add(cue.sound);
      if (cue.meaning) for (const skin of [...SKINS, "plain"] as const) used.add(SKIN_SOUNDS[skin][cue.meaning]);
    }
    expect([...used].sort()).toEqual(Object.keys(RECIPES).sort());
  });

  it("plays a meaning in the company's skin, and plain when signed out", () => {
    expect(soundFor("action.done", "bubble")).toBe("bubbleSuccess");
    expect(soundFor("action.done", "press")).toBe("pressSuccess");
    expect(soundFor("action.done", null)).toBe("chime");
    expect(soundFor("payment.saved", "mech")).toBe("paid");
  });

  it("keeps map panning silent", () => {
    expect(soundFor("map.panned", "bubble")).toBeNull();
    expect(soundFor("map.wandered", null)).toBeNull();
  });
});

describe("the person's switch", () => {
  it("is on by default, off by default under reduced motion, and the person's choice wins", () => {
    expect(soundOn(null, false)).toBe(true);
    expect(soundOn(null, true)).toBe(false);
    expect(soundOn("on", true)).toBe(true);
    expect(soundOn("off", false)).toBe(false);
  });
});
