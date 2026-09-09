import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCENT_KEY,
  ACCENT_INIT_SCRIPT,
  DEFAULT_ACCENT,
  isAccentId,
} from "@/lib/accent";
import { ACCENT_THEMES } from "@/lib/accentThemes";

const CSS = readFileSync("app/globals.css", "utf8");

describe("the accent catalogue", () => {
  it("gives every theme a distinct id and a non-empty label", () => {
    const ids = ACCENT_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ACCENT_THEMES) expect(t.label.trim().length).toBeGreaterThan(0);
  });

  it("defaults to a theme that actually exists", () => {
    expect(isAccentId(DEFAULT_ACCENT)).toBe(true);
  });

  it("rejects anything that is not a known id", () => {
    expect(isAccentId("nope")).toBe(false);
    expect(isAccentId(null)).toBe(false);
    expect(isAccentId(7)).toBe(false);
    // An id stored by a build that had a theme this one does not.
    expect(isAccentId("copper")).toBe(false);
  });

  it("keeps the default first, so the picker opens on what you already have", () => {
    expect(ACCENT_THEMES[0].id).toBe(DEFAULT_ACCENT);
  });
});

describe("the catalogue and the stylesheet agree", () => {
  // The two are written by the same generator run, so a mismatch means someone edited one
  // by hand -- which is exactly the failure this catches.
  it("has a light and a dark CSS block for every theme", () => {
    for (const t of ACCENT_THEMES) {
      expect(CSS, `light block for ${t.id}`).toContain(`:root[data-accent="${t.id}"] .meridian,`);
      expect(CSS, `dark block for ${t.id}`).toContain(
        `:root[data-accent="${t.id}"][data-skin="dark"] .meridian,`,
      );
    }
  });

  it("has ground-scoped map ink for every theme", () => {
    // Keyed on the basemap's ground rather than the skin: a cream basemap needs dark
    // strokes even on a dark skin. See the generated block's own comment.
    for (const t of ACCENT_THEMES) {
      for (const ground of ["light", "dark"]) {
        expect(CSS, `${t.id}/${ground} ground block`).toContain(
          `:root[data-accent="${t.id}"] [data-ground="${ground}"]`,
        );
      }
    }
  });

  it("declares the swatch colour the CSS actually uses", () => {
    for (const t of ACCENT_THEMES) {
      const i = CSS.indexOf(`:root[data-accent="${t.id}"] .meridian,`);
      const block = CSS.slice(CSS.indexOf("{", i), CSS.indexOf("}", i));
      expect(block, `${t.id} light --accent`).toContain(`--accent: ${t.swatch.light};`);
    }
  });

  it("never lets a theme override a status colour", () => {
    /* green means visited, amber means needs coverage, red means keep out -- and those
       three are shared with /report and /analytics. A theme that repaints them breaks the
       language the map is written in, so the generator moves the accent instead. */
    const begin = CSS.indexOf("/* ACCENT-THEMES:BEGIN");
    const generated = CSS.slice(begin, CSS.indexOf("/* ACCENT-THEMES:END */"));
    for (const token of ["--good:", "--warn:", "--crit:", "--info:", "--tint-plum:"]) {
      expect(generated, `generated block must not set ${token}`).not.toContain(token);
    }
  });
});

describe("the pre-paint init script", () => {
  it("reads the same key applyAccent writes", () => {
    expect(ACCENT_INIT_SCRIPT).toContain(JSON.stringify(ACCENT_KEY));
  });

  it("uses a different key from the theme, so one choice cannot reset the other", () => {
    expect(ACCENT_KEY).not.toBe("coverage-theme");
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
      new Function("localStorage", "document", ACCENT_INIT_SCRIPT)(
        { getItem: () => stored },
        doc,
      );
      return html.attr;
    };
    expect(run(null)).toEqual({});
    expect(run("teal")).toEqual({ "data-accent": "teal" });
  });

  it("survives localStorage throwing, as it does in a private window", () => {
    const doc = { documentElement: { setAttribute: () => {} } };
    expect(() =>
      new Function("localStorage", "document", ACCENT_INIT_SCRIPT)(
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
