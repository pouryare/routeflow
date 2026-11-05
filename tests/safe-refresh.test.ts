import { describe, it, expect } from "vitest";
import { unsentCount } from "@/lib/offline/syncEngine";

describe("safe refresh (Z19)", () => {
  it("counts everything the server has not accepted as unsent", () => {
    const st = (s: string) => ({ status: s });
    expect(unsentCount([st("applied"), st("applied")])).toBe(0);
    expect(unsentCount([st("held"), st("pending"), st("sending"), st("failed"), st("conflict"), st("applied")])).toBe(5);
  });
});
