import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FONT_KEY, FONT_INIT_SCRIPT, DEFAULT_FONT, isFontId } from "@/lib/font";
import { FONT_CHOICES } from "@/lib/fontChoices";

const CSS = readFileSync("app/globals.css", "utf8");

describe("the font catalogue", () => {
  it("gives every choice a distinct id and a non-empty label", () => {
    const ids = FONT_CHOICES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FONT_CHOICES) expect(f.label.trim().length).toBeGreaterThan(0);
  });

  it("defaults to a choice that actually exists", () => {
    expect(isFontId(DEFAULT_FONT)).toBe(true);
  });

  it("keeps Peyda (the default) first, so the picker opens on what you already have", () => {
    expect(FONT_CHOICES[0].id).toBe(DEFAULT_FONT);
    expect(DEFAULT_FONT).toBe("peyda");
  });

  it("rejects anything that is not a known id", () => {
    expect(isFontId("nope")).toBe(false);
    expect(isFontId(null)).toBe(false);
    expect(isFontId(7)).toBe(false);
    expect(isFontId("comic")).toBe(false);
  });
});

describe("the catalogue and the stylesheet agree", () => {
  it("remaps --font-ui for every non-default choice", () => {
    for (const f of FONT_CHOICES) {
      if (f.id === DEFAULT_FONT) continue;
      expect(CSS, `data-font block for ${f.id}`).toContain(`:root[data-font="${f.id}"]`);
    }
  });
});

describe("the pre-paint init script", () => {
  it("reads the same key applyFont writes", () => {
    expect(FONT_INIT_SCRIPT).toContain(JSON.stringify(FONT_KEY));
  });

  it("uses a different key from the theme and the accent", () => {
    expect(FONT_KEY).not.toBe("coverage-theme");
    expect(FONT_KEY).not.toBe("coverage-accent");
  });

  it("sets no attribute when nothing is stored, landing on the server-rendered default", () => {
    const html: { attr: Record<string, string> } = { attr: {} };
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          html.attr[k] = v;
        },
      },
    };
    const run = (stored: string | null) => {
      html.attr = {};
      new Function("localStorage", "document", FONT_INIT_SCRIPT)({ getItem: () => stored }, doc);
      return html.attr;
    };
    expect(run(null)).toEqual({});
    expect(run("yekan")).toEqual({ "data-font": "yekan" });
  });

  it("survives localStorage throwing, as it does in a private window", () => {
    const doc = { documentElement: { setAttribute: () => {} } };
    expect(() =>
      new Function("localStorage", "document", FONT_INIT_SCRIPT)(
        {
          getItem() {
            throw new Error("denied");
          },
        },
        doc,
      ),
    ).not.toThrow();
  });
});
