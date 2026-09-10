import { describe, it, expect } from "vitest";
import { syncBadge } from "@/components/SyncStatus";

/** The indicator is for exceptions.
 *
 *  "Online, nothing queued" is the state the app is in almost all of the time, and a
 *  badge that is always lit is a badge nobody reads — so the one state that needs no
 *  action renders nothing at all. The user asked for exactly this: "the آنلاین indicator
 *  should be hidden, we only need to show the other status".
 */
describe("syncBadge", () => {
  it("shows nothing when online and fully synced", () => {
    expect(syncBadge({ online: true, pending: 0, trouble: 0 })).toBeNull();
  });

  it("shows offline", () => {
    expect(syncBadge({ online: false, pending: 0, trouble: 0 })?.label).toBe("آفلاین");
  });

  it("shows a queue while online", () => {
    const b = syncBadge({ online: true, pending: 3, trouble: 0 })!;
    expect(b.label).toContain("در صف");
    expect(b.tone).toBe("warn");
  });

  it("trouble outranks a queue", () => {
    const b = syncBadge({ online: true, pending: 3, trouble: 1 })!;
    expect(b.tone).toBe("crit");
    expect(b.label).toContain("مشکل");
  });

  it("offline outranks everything", () => {
    /* Nothing drains while there is no connection, so the queue and the failures are both
       downstream of the one fact worth reporting. */
    expect(syncBadge({ online: false, pending: 3, trouble: 1 })?.label).toBe("آفلاین");
  });

  it("never labels in Latin", () => {
    for (const s of [
      { online: false, pending: 0, trouble: 0 },
      { online: true, pending: 2, trouble: 0 },
      { online: true, pending: 0, trouble: 5 },
    ]) {
      expect(syncBadge(s)!.label).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});
