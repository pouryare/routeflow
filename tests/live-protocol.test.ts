import { describe, it, expect } from "vitest";
import { canReceive, eventFrame, frame, isTopic, lastSeenId, needsReset, retryMs } from "@/lib/live/protocol";

/* Live updates (issue #58): who may receive an event, where a reconnecting phone resumes, and the
 * frames on the wire. */

const sara = { userId: 7, organizationId: 1, roles: ["phone_sales" as const] };

describe("canReceive", () => {
  const ev = (o: Partial<{ organization_id: number; audience_users: number[] | null; audience_roles: string[] | null }>) => ({
    organization_id: 1,
    audience_users: null,
    audience_roles: null,
    ...o,
  });

  it("gives an event with no audience to everyone in its company, and no one in another", () => {
    expect(canReceive(sara, ev({}))).toBe(true);
    expect(canReceive(sara, ev({ organization_id: 2 }))).toBe(false);
  });

  it("limits to the named people, and to the named roles", () => {
    expect(canReceive(sara, ev({ audience_users: [3, 7] }))).toBe(true);
    expect(canReceive(sara, ev({ audience_users: [3] }))).toBe(false);
    expect(canReceive(sara, ev({ audience_roles: ["owner", "phone_sales"] }))).toBe(true);
    expect(canReceive(sara, ev({ audience_roles: ["owner"] }))).toBe(false);
  });

  it("needs both lists to match when both are given", () => {
    expect(canReceive(sara, ev({ audience_users: [7], audience_roles: ["owner"] }))).toBe(false);
    expect(canReceive(sara, ev({ audience_users: [7], audience_roles: ["phone_sales"] }))).toBe(true);
  });

  it("reads an empty audience as nobody, never as everyone", () => {
    expect(canReceive(sara, ev({ audience_users: [] }))).toBe(false);
    expect(canReceive(sara, ev({ audience_roles: [] }))).toBe(false);
  });
});

describe("where a reconnecting phone resumes", () => {
  it("takes the newer of the header and ?after=, and ignores junk", () => {
    expect(lastSeenId("120", "90")).toBe(120);
    expect(lastSeenId(null, "90")).toBe(90);
    expect(lastSeenId("abc", "-5")).toBe(0);
    expect(lastSeenId(" 42 ", null)).toBe(42);
  });

  it("catches up inside the log and resets outside it", () => {
    expect(needsReset(0, null, null)).toBe(false); // first connection
    expect(needsReset(120, 100, 150)).toBe(false);
    expect(needsReset(99, 100, 150)).toBe(false); // the very next one is still there
    expect(needsReset(50, 100, 150)).toBe(true); // pruned in between
    expect(needsReset(200, 100, 150)).toBe(true); // a database restored behind the phone
    expect(needsReset(5, null, null)).toBe(true);
  });
});

describe("frames", () => {
  it("puts the id first and the data on one line", () => {
    expect(eventFrame({ id: 5, topic: "notifications", data_json: '{"n":1}' })).toBe('id: 5\ndata: {"t":"notifications","d":{"n":1}}\n\n');
    expect(eventFrame({ id: 6, topic: "x", data_json: null })).toBe('id: 6\ndata: {"t":"x","d":null}\n\n');
    expect(frame("presence", { a: "خط\nدوم" })).toBe('data: {"t":"presence","d":{"a":"خط\\nدوم"}}\n\n');
  });

  it("accepts plain topics only", () => {
    expect(isTopic("chat:42")).toBe(true);
    expect(isTopic("Chat 42")).toBe(false);
    expect(isTopic("")).toBe(false);
  });

  it("spreads reconnects between 2 and 8 seconds", () => {
    expect(retryMs(() => 0)).toBe(2000);
    expect(retryMs(() => 0.999)).toBeLessThan(8000);
  });
});
