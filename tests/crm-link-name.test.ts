import { describe, it, expect } from "vitest";
import { placeNameFromUrl } from "@/lib/crm/linkName";

describe("placeNameFromUrl", () => {
  it("reads the /place/ segment of a Google Maps URL", () => {
    expect(placeNameFromUrl("https://www.google.com/maps/place/%DA%A9%D8%A8%D8%A7%D8%A8%DB%8C+%D9%86%D8%A7%DB%8C%D8%A8/@35.7,51.4,17z")).toBe("کبابی نایب");
  });
  it("returns null when there is no place name", () => {
    expect(placeNameFromUrl("https://www.google.com/maps/@35.7,51.4,17z")).toBeNull();
    expect(placeNameFromUrl("not a url")).toBeNull();
  });
});
