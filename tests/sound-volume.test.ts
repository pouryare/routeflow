import { describe, expect, it } from "vitest";
import { VOLUMES } from "@/lib/sound";

describe("sound volume steps", () => {
  it("run from 20 to 100 in tens, and the slider's steps match", () => {
    expect([...VOLUMES]).toEqual([20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });
});
