import { describe, it, expect } from "vitest";
import * as v from "@/lib/crm/vocab";
import { normPhone, formatPhone, telHref, normName, namesAlike } from "@/lib/crm/phone";

describe("CRM vocabulary", () => {
  it("provides Persian labels for every closed vocabulary", () => {
    const vocabularies: [readonly string[], Record<string, string>][] = [
      [v.BUSINESS_TYPES, v.BUSINESS_TYPE_LABEL], [v.CONTACT_ROLES, v.CONTACT_ROLE_LABEL],
      [v.VERIFICATIONS, v.VERIFICATION_LABEL], [v.LEAD_SOURCES, v.LEAD_SOURCE_LABEL],
      [v.SALES_STAGES, v.SALES_STAGE_LABEL], [v.PRICE_TIERS, v.PRICE_TIER_LABEL],
      [v.CONTACT_STATUSES, v.CONTACT_STATUS_LABEL], [v.TEMPERATURES, v.TEMPERATURE_LABEL],
      [v.LOST_REASONS, v.LOST_REASON_LABEL], [v.SKIP_REASONS, v.SKIP_REASON_LABEL],
      [v.NOT_FIT_REASONS, v.NOT_FIT_LABEL],
    ];
    for (const [codes, labels] of vocabularies) {
      expect(Object.keys(labels).sort()).toEqual([...codes].sort());
      for (const code of codes) expect(labels[code]).toMatch(/[\u0600-\u06ff]/);
    }
  });
  it("derives every CHECK-constrained customer type", () => {
    expect(v.BUSINESS_TYPES.map(v.customerTypeFor)).toEqual([
      "RESTAURANT", "RESTAURANT", "RESTAURANT", "CAFE", "RETAIL", "RETAIL",
      "CATERING", "HOTEL", "RESTAURANT", "OTHER",
    ]);
  });
  it("distinguishes decision makers and invalid records", () => {
    expect(v.CONTACT_ROLES.filter(v.isDecider)).toEqual(["OWNER", "MANAGER", "PURCHASING", "CHEF"]);
    expect(v.VERIFICATIONS.filter(v.isInvalid)).toEqual([
      "invalid_closed", "invalid_other_business", "invalid_not_fit", "invalid_not_found",
    ]);
    expect(v.CUSTOMER_STAGES).toEqual(["first_order", "customer", "repeat_customer"]);
  });
  it("classifies sources and allowed next actions", () => {
    expect(v.LEAD_SOURCES.map((source) => v.SOURCE_KIND[source])).toEqual([
      "link", "link", "link", "link", "link", "ref", "ref", "here", "other",
    ]);
    expect([...v.FOOD_APP_SOURCES]).toEqual(["SNAPPFOOD", "TAPSI_FOOD"]);
    // "reminder" is the eighth kind, and it is not optional: the lead-visit flow sets
    // next_kind: "reminder" when a driver chooses to come back, and applyLeadVisit writes
    // that straight into a task. Without it in the list a real reminder task is invalid.
    expect(v.NEXT_KINDS).toEqual(["call", "visit", "verify_visit", "sample_delivery", "quote_followup", "outreach", "order", "reminder"]);
  });
  it("validates unknown inputs and formats Persian digits", () => {
    expect(v.isOneOf(v.PRICE_TIERS, "mid")).toBe(true);
    for (const input of ["cheap", null, undefined, 1, {}, ["mid"]]) {
      expect(v.isOneOf(v.PRICE_TIERS, input)).toBe(false);
    }
    expect(v.faDigits("12:30")).toBe("۱۲:۳۰");
    expect(v.faDigits("۰۹۱۲ +98")).toBe("۰۹۱۲ +۹۸");
  });
});

describe("CRM phone and name normalization", () => {
  it.each([
    ["۰۹۱۲ ۰۰۰ ۱۲۳۴", "9120001234"], ["٠٩١٢ ٠٠٠ ١٢٣٤", "9120001234"],
    ["+98 912 000 1234", "9120001234"], ["0098 912 000 1234", "9120001234"],
    ["9124845102", "9124845102"], ["021-7730-1105", "2177301105"],
    ["123", null], [null, null], [undefined, null], ["", null],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(normPhone(raw)).toBe(expected);
  });
  it("formats and links a normalized phone", () => {
    expect(formatPhone("9120001234")).toBe("0912 000 1234");
    expect(telHref("9120001234")).toBe("tel:09120001234");
  });
  it("normalizes names for comparison without altering source text", () => {
    expect(normName(" كافه لميز! ")).toBe("کافهلمیز");
    expect(normName("Cafe - ۱۲")).toBe("cafe12");
    expect(namesAlike("کافه لمیز", "کافه لمیز تجریش")).toBe(true);
    expect(namesAlike("کافه لمیز تجریش", "کافه لمیز")).toBe(true);
    expect(namesAlike("كافه لميز", "کافه لمیز")).toBe(true);
    expect(namesAlike("کافه", "کافه نادری")).toBe(false);
    expect(namesAlike("", "کافه")).toBe(false);
    expect(namesAlike("!!!", "؟")).toBe(false);
  });
});

import { TASK_KIND_LABEL, OUTCOME_LABEL } from "@/lib/tasks/labels";
import { NEXT_KINDS } from "@/lib/crm/vocab";
import { OUTCOME_CODES } from "@/lib/crm/outcomes";
import { OUTBOX_HOLD_MS } from "@/lib/offline/constants";

describe("labels the CRM relies on", () => {
  it("labels every next-action kind and every outcome", () => {
    for (const k of NEXT_KINDS) expect((TASK_KIND_LABEL as Record<string, string>)[k], k).toBeTruthy();
    for (const c of OUTCOME_CODES) expect(OUTCOME_LABEL[c], c).toBeTruthy();
  });
  it("holds an undo for five seconds", () => expect(OUTBOX_HOLD_MS).toBe(5000));
});
