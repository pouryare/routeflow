import { describe, expect, it } from "vitest";
import { feedbackFor } from "@/lib/actionFeedback";

describe("feedbackFor", () => {
  it("names the kind of change", () => {
    expect(feedbackFor("POST", "/api/admin/users")).toBe("انجام شد");
    expect(feedbackFor("patch", "/api/admin/users/3")).toBe("ذخیره شد");
    expect(feedbackFor("DELETE", "/api/admin/groups/2")).toBe("حذف شد");
  });
  it("stays quiet for reads and for background traffic", () => {
    expect(feedbackFor("GET", "/api/admin/users")).toBeNull();
    expect(feedbackFor("POST", "/api/sync/push")).toBeNull();
    expect(feedbackFor("POST", "/api/tutorials/seen")).toBeNull();
    expect(feedbackFor("PATCH", "/api/notifications")).toBeNull();
    expect(feedbackFor("POST", "/api/login")).toBeNull();
    expect(feedbackFor("POST", "/somewhere-else")).toBeNull();
  });
  it("still speaks for notification settings, which are a person's choice", () => {
    expect(feedbackFor("PATCH", "/api/notifications/prefs")).toBe("ذخیره شد");
  });
});
