import { describe, expect, it } from "vitest";
import { parseFavourites, toggleFavourite } from "@/lib/favourites";

describe("favourites", () => {
  it("reads a saved list and ignores junk", () => {
    expect(parseFavourites("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseFavourites("[1,\"x\",2.5]")).toEqual([1]);
    expect(parseFavourites("not json")).toEqual([]);
    expect(parseFavourites(null)).toEqual([]);
    expect(parseFavourites("{\"a\":1}")).toEqual([]);
  });
  it("toggles an id on and off", () => {
    expect(toggleFavourite([1], 2)).toEqual([1, 2]);
    expect(toggleFavourite([1, 2], 1)).toEqual([2]);
  });
});
