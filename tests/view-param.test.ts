import { describe, it, expect } from "vitest";
import { one, oneOf } from "@/lib/viewParam";

/** A `?view=` param, read once and the same way everywhere.
 *
 *  Next hands over a string OR an array, because a URL may repeat the key
 *  (`?view=one&view=all`). `Number([..])` quietly produces NaN and
 *  `view === "board"` quietly fails, so a page that forgets the guard shows the
 *  default view for a URL that asked for another. Four pages are about to read this
 *  param, so it is read once, here. */
describe("reading a ?view= param", () => {
  it("takes the first when Next hands over an array", () => {
    expect(one({ view: ["board", "journey"] })).toBe("board");
  });

  it("passes a single string through", () => {
    expect(one({ view: "journey" })).toBe("journey");
  });

  it("is undefined when absent", () => {
    expect(one({})).toBeUndefined();
    expect(one({ other: "x" })).toBeUndefined();
  });

  it("falls back to the default for an unknown value", () => {
    expect(oneOf({ view: "nonsense" }, ["board", "journey"], "board")).toBe("board");
  });

  it("accepts a known value", () => {
    expect(oneOf({ view: "journey" }, ["board", "journey"], "board")).toBe("journey");
  });

  it("falls back when the param is absent, or an empty array", () => {
    expect(oneOf({}, ["board"], "board")).toBe("board");
    expect(oneOf({ view: [] }, ["board"], "board")).toBe("board");
  });

  it("reads a different key without confusing the two", () => {
    /* The journey's own one/all switch MOVES to ?mode= when it moves onto the orders
       host, precisely because one() takes the FIRST value of a repeated key: leaving it
       as `?view=journey&view=all` would silently drop `all`. A separate key is the
       fix, and this asserts the two do not collide. */
    const p = { view: "journey", mode: "all" };
    expect(one(p)).toBe("journey");
    expect(one(p, "mode")).toBe("all");
  });
});
