# CRM Core + Field Flows (P1 + P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working field CRM: one Business entity with contacts and an append-only activity log, backend scoping, the `/crm` «مشتریان و سرنخ‌ها» page, and three tap flows — after-call, Add Lead (with price tier, working hours and phone-less leads) and the driver verification visit — wired into کارهای من / امروز.

**Architecture:** `customers` stays the Business; new `contacts` and `activities` tables; cached state columns on `customers` provably equal a pure replay of `activities`. Every tap flow is a pure config in `lib/crm/flows/*` driven by one pure machine; the client renders it in the existing meridian bottom sheet, and the server replays the same answers through the same config before writing. All SQL lives in `lib/repo/crm/*`.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routing APIs — AGENTS.md), React 19, `node:sqlite`, vitest 4, lucide-react via `components/meridian/icon-map.ts`.

**Spec:** `docs/superpowers/specs/2026-09-11-crm-leads-customers-design.md` (sections 0–8). Rulebook: `docs/tap-flow-principles.md`.

## Global Constraints

- All new raw SQL lives under `lib/repo/` (tests/repo-boundary.test.ts). Pure logic lives under `lib/crm/` and never imports `lib/db`.
- Every tenant table has `organization_id NOT NULL`; new tables are appended to `TENANT_TABLES` and must be created **before** the TENANT_TABLES loop in `getDb()` (it ALTERs every listed table).
- Out-of-scope rows answer **404**, never 403.
- No raw enum codes in UI text; every task kind created has a label in `lib/tasks/labels.ts` (tests/no-raw-enum-copy.test.ts).
- `<Icon name>` only, no emoji. RTL, Persian digits, Tehran time (UTC+03:30, no DST).
- Tap flows: one question per screen; the last answer autosaves; toast «لغو» with a **5 s** window (`OUTBOX_HOLD_MS = 5000`); done screen returns after **5 s**.
- Sheets use the existing meridian bottom sheet: `.meridian-scrim` + `.sheet.on` + `.grab` + `.sheethead` + `.x`, `useSwipeDismiss(ref, "down", onClose, open)`.
- `activities` is append-only (DB triggers). Never `DELETE FROM activities` in tests — create fresh customers per test instead.
- Do **not** run `npm run build` or restart `routeflow` (production service); verification is `npm test`, `npx tsc --noEmit`, `npm run lint`. Deploy happens with the user.
- Work on branch `crm-core-field-flows` off `main`. Commit after every task (the repo's Stop hook also commits and pushes).

## File Map

| File | Responsibility |
|---|---|
| `lib/crm/vocab.ts` | Closed vocabularies + Persian labels, `customerTypeFor`, `faDigits` |
| `lib/crm/phone.ts` | `normPhone`, `formatPhone`, `telHref`, `normName`, `namesAlike` |
| `lib/crm/stage.ts` | `advanceStage`, `lifecycleFor`, `stageRank` |
| `lib/crm/temperature.ts` | `autoTemperature` |
| `lib/crm/due.ts` | `DueSpec`, `resolveDue`, `labelDue`, `tehranParts` |
| `lib/crm/hours.ts` | Working hours: parse/validate/format, `isOpenAt`, `nextOpenAt` |
| `lib/crm/outcomes.ts` | Outcome codes → activity facts |
| `lib/crm/replay.ts` | `replayCrmState(activities)` |
| `lib/crm/flows/types.ts` | Flow config/state types |
| `lib/crm/flows/machine.ts` | `startFlow`, `viewStep`, `answerStep`, `backStep`, `replayAnswers`, `interpolate` |
| `lib/crm/flows/validate.ts` | `checkFlow` (dead ends, tap budget) |
| `lib/crm/flows/common.ts` | Shared option builders, skip step |
| `lib/crm/flows/afterCall.ts` | After-call / talked-now flow |
| `lib/crm/flows/addLead.ts` | Add Lead flow + `basicsOf`, `pinOf`, `hoursOf`, `linkOf` |
| `lib/crm/flows/driverVisit.ts` | Driver verification visit flow |
| `lib/repo/crm/migrate.ts` | `createCrmTables`, `migrateCrm` (columns + backfill) |
| `lib/repo/crm/businesses.ts` | List/count/get, flow contexts |
| `lib/repo/crm/dedupe.ts` | `findDuplicates` |
| `lib/repo/crm/write.ts` | `applyFlow`, `applyFlowCore`, `createLead`, `claimBusiness`, `requestReassign`, `CrmError` |
| `lib/repo/crm/driverVisits.ts` | `driverVisitsFor`, `applyDriverVisit` |
| `lib/repo/crm/state.ts` | `recomputeState` (moved out of write.ts in Task 20) |
| `lib/repo/crm/conversion.ts` | `convertOnDelivery` — hooked into `advanceOrder` |
| `lib/repo/crm/http.ts` | `crmErrorResponse`, `idParam`, `CRM_ROLES` for the routes |
| `lib/crm/share.ts`, `lib/crm/linkName.ts` | Price-list text + share links; place name from a Maps URL |
| `components/crm/flowHost.ts` | The host contract every flow component follows |
| `components/crm/{AfterCallFlow,AddLeadFlow,PinStep,LinkStep,BasicsStep,HoursPicker,CrmBoard,BusinessCard}.tsx`, `use{HeldSave,CallReturn}.ts` | Flow components, custom steps, the board |
| `lib/session.ts` | + `crmFilter`, `canSeeBusiness`, `canWriteBusiness`, `isCrmManager` |
| `app/api/crm/**` | Thin routes |
| `components/tapflow/TapFlow.tsx`, `FlowDone.tsx` | Generic sheet renderer |
| `components/crm/*` | Hooks, flows' custom steps, board, cards |
| `components/driver/VerifyVisits.tsx` | Driver panel |

---

## Task 0: Branch

- [ ] **Step 1:** `cd /root/pourya/RouteFlow && git checkout main && git pull -q && git checkout -b crm-core-field-flows`
- [ ] **Step 2:** `npx vitest run 2>&1 | tail -5` — record the baseline pass count in the first commit message of Task 1.

---

## Task 1: Vocabulary and phone/name normalisation

**Files:**
- Create: `lib/crm/vocab.ts`, `lib/crm/phone.ts`
- Test: `tests/crm-vocab.test.ts`

**Interfaces — Produces:** `BusinessType`, `BUSINESS_TYPES`, `BUSINESS_TYPE_LABEL`, `customerTypeFor(t)`, `PriceTier`/`PRICE_TIERS`/`PRICE_TIER_LABEL`, `ContactRole`/`CONTACT_ROLES`/`CONTACT_ROLE_LABEL`/`isDecider`, `ContactStatus`/`CONTACT_STATUSES`/`CONTACT_STATUS_LABEL`, `SalesStage`/`SALES_STAGES`/`SALES_STAGE_LABEL`/`CUSTOMER_STAGES`, `Verification`/`VERIFICATIONS`/`VERIFICATION_LABEL`/`isInvalid`, `Temperature`/`TEMPERATURES`/`TEMPERATURE_LABEL`, `LeadSource`/`LEAD_SOURCES`/`LEAD_SOURCE_LABEL`/`SOURCE_KIND`/`FOOD_APP_SOURCES`, `LostReason`/`LOST_REASONS`/`LOST_REASON_LABEL`, `SkipReason`/`SKIP_REASONS`/`SKIP_REASON_LABEL`, `NotFitReason`/`NOT_FIT_REASONS`/`NOT_FIT_LABEL`, `NextKind`/`NEXT_KINDS`, `isOneOf`, `faDigits`; `normPhone`, `formatPhone`, `telHref`, `normName`, `namesAlike`.

- [ ] **Step 1: Write the failing test** — `tests/crm-vocab.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  BUSINESS_TYPES, BUSINESS_TYPE_LABEL, customerTypeFor, CONTACT_ROLES, CONTACT_ROLE_LABEL,
  isDecider, VERIFICATIONS, VERIFICATION_LABEL, isInvalid, LEAD_SOURCES, LEAD_SOURCE_LABEL,
  SOURCE_KIND, SALES_STAGES, SALES_STAGE_LABEL, PRICE_TIERS, PRICE_TIER_LABEL, isOneOf, faDigits,
} from "@/lib/crm/vocab";
import { normPhone, formatPhone, telHref, namesAlike } from "@/lib/crm/phone";

describe("vocab", () => {
  it("labels every code of every vocabulary", () => {
    for (const t of BUSINESS_TYPES) expect(BUSINESS_TYPE_LABEL[t]).toBeTruthy();
    for (const r of CONTACT_ROLES) expect(CONTACT_ROLE_LABEL[r]).toBeTruthy();
    for (const v of VERIFICATIONS) expect(VERIFICATION_LABEL[v]).toBeTruthy();
    for (const s of LEAD_SOURCES) { expect(LEAD_SOURCE_LABEL[s]).toBeTruthy(); expect(SOURCE_KIND[s]).toBeTruthy(); }
    for (const s of SALES_STAGES) expect(SALES_STAGE_LABEL[s]).toBeTruthy();
    for (const p of PRICE_TIERS) expect(PRICE_TIER_LABEL[p]).toBeTruthy();
  });
  it("derives the CHECK-constrained customer_type from business_type", () => {
    expect(customerTypeFor("KEBAB")).toBe("RESTAURANT");
    expect(customerTypeFor("CHAIN")).toBe("RESTAURANT");
    expect(customerTypeFor("BAKERY")).toBe("RETAIL");
    expect(customerTypeFor("HOTEL")).toBe("HOTEL");
    expect(customerTypeFor("OTHER")).toBe("OTHER");
  });
  it("knows deciders and invalid verifications", () => {
    expect(isDecider("PURCHASING")).toBe(true);
    expect(isDecider("RECEPTION")).toBe(false);
    expect(isInvalid("invalid_closed")).toBe(true);
    expect(isInvalid("wrong_number")).toBe(false);
  });
  it("isOneOf and faDigits", () => {
    expect(isOneOf(PRICE_TIERS, "mid")).toBe(true);
    expect(isOneOf(PRICE_TIERS, "cheap")).toBe(false);
    expect(faDigits("12:30")).toBe("۱۲:۳۰");
  });
});

describe("phone", () => {
  it("normalises Persian digits, spaces and country code to the last 10 digits", () => {
    expect(normPhone("۰۹۱۲ ۰۰۰ ۱۲۳۴")).toBe("9120001234");
    expect(normPhone("+98 912 000 1234")).toBe("9120001234");
    expect(normPhone("9124845102")).toBe("9124845102");
    expect(normPhone("021-7730-1105")).toBe("2177301105");
    expect(normPhone("123")).toBeNull();
    expect(normPhone(null)).toBeNull();
  });
  it("formats and links", () => {
    expect(formatPhone("9120001234")).toBe("0912 000 1234");
    expect(telHref("9120001234")).toBe("tel:09120001234");
  });
  it("treats containment of a long enough name as alike", () => {
    expect(namesAlike("کافه لمیز", "کافه لمیز تجریش")).toBe(true);
    expect(namesAlike("كافه لميز", "کافه لمیز")).toBe(true);
    expect(namesAlike("کافه", "کافه نادری")).toBe(false);
    expect(namesAlike("", "کافه")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/crm-vocab.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/crm/vocab.ts`

```ts
import type { CustomerType } from "@/lib/types";

/** The CRM's closed vocabularies and their Persian labels, in one place: the tap flows offer
 *  exactly these, the server validates against exactly these, and no screen prints a code. */

export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Latin digits to Persian, for strings that are not plain numbers ("12:30", "0912 …"). */
export function faDigits(s: string): string {
  return s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export const BUSINESS_TYPES = [
  "KEBAB", "IRANIAN", "FAST_FOOD", "CAFE", "CONFECTIONERY", "BAKERY", "CATERING", "HOTEL", "CHAIN", "OTHER",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  KEBAB: "کبابی", IRANIAN: "ایرانی", FAST_FOOD: "فست‌فود", CAFE: "کافه", CONFECTIONERY: "شیرینی‌فروشی",
  BAKERY: "نانوایی", CATERING: "کترینگ", HOTEL: "هتل", CHAIN: "زنجیره‌ای", OTHER: "سایر",
};

/** customer_type carries a CHECK constraint that the academy's objection cards key on.
 *  Widening it would rebuild customers, so it is derived from the finer business_type. */
export function customerTypeFor(t: BusinessType): CustomerType {
  switch (t) {
    case "KEBAB": case "IRANIAN": case "FAST_FOOD": case "CHAIN": return "RESTAURANT";
    case "CAFE": return "CAFE";
    case "CONFECTIONERY": case "BAKERY": return "RETAIL";
    case "CATERING": return "CATERING";
    case "HOTEL": return "HOTEL";
    default: return "OTHER";
  }
}

export const PRICE_TIERS = ["low", "mid", "high", "unknown"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];
export const PRICE_TIER_LABEL: Record<PriceTier, string> = { low: "ارزان", mid: "متوسط", high: "گران", unknown: "نامعلوم" };

export const CONTACT_ROLES = [
  "OWNER", "MANAGER", "PURCHASING", "CHEF", "RECEPTION", "ACCOUNTANT", "STOREKEEPER", "STAFF", "OTHER",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  OWNER: "مالک / صاحب‌کار", MANAGER: "مدیر", PURCHASING: "مسئول خرید", CHEF: "سرآشپز",
  RECEPTION: "پذیرش / صندوق", ACCOUNTANT: "حسابدار", STOREKEEPER: "انباردار", STAFF: "کارمند", OTHER: "سایر",
};
const DECIDERS: ReadonlySet<ContactRole> = new Set<ContactRole>(["OWNER", "MANAGER", "PURCHASING", "CHEF"]);
export const isDecider = (r: ContactRole): boolean => DECIDERS.has(r);

export const CONTACT_STATUSES = [
  "not_contacted", "attempted", "no_answer", "busy", "wrong_number", "unavailable", "contacted",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  not_contacted: "تماس‌نگرفته", attempted: "تلاش شده", no_answer: "بی‌پاسخ", busy: "مشغول",
  wrong_number: "شماره اشتباه", unavailable: "در دسترس نیست", contacted: "صحبت شده",
};

export const SALES_STAGES = [
  "unknown", "not_interested", "interested", "sample", "quotation", "negotiation",
  "first_order", "customer", "repeat_customer", "lost",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];
export const SALES_STAGE_LABEL: Record<SalesStage, string> = {
  unknown: "سرنخ تازه", not_interested: "علاقه ندارد", interested: "علاقه‌مند", sample: "نمونه",
  quotation: "پیش‌فاکتور", negotiation: "مذاکره", first_order: "اولین سفارش", customer: "مشتری",
  repeat_customer: "مشتری تکراری", lost: "از دست رفته",
};
export const CUSTOMER_STAGES: readonly SalesStage[] = ["first_order", "customer", "repeat_customer"];

export const VERIFICATIONS = [
  "unverified", "verified", "renamed", "moved", "wrong_number",
  "invalid_closed", "invalid_other_business", "invalid_not_fit", "invalid_not_found",
] as const;
export type Verification = (typeof VERIFICATIONS)[number];
export const VERIFICATION_LABEL: Record<Verification, string> = {
  unverified: "تأییدنشده", verified: "تأییدشده", renamed: "تأیید شد · نام تازه", moved: "تأیید شد · جابه‌جا",
  wrong_number: "شماره اشتباه", invalid_closed: "نامعتبر · تعطیل", invalid_other_business: "نامعتبر · کسب‌وکار دیگر",
  invalid_not_fit: "نامعتبر · مناسب نیست", invalid_not_found: "نامعتبر · پیدا نشد",
};
export const isInvalid = (v: Verification): boolean => v.startsWith("invalid_");

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export type Temperature = (typeof TEMPERATURES)[number];
export const TEMPERATURE_LABEL: Record<Temperature, string> = { hot: "داغ", warm: "گرم", cold: "سرد" };

export const LEAD_SOURCES = [
  "GOOGLE_MAPS", "GOOGLE_SEARCH", "SNAPPFOOD", "TAPSI_FOOD", "INSTAGRAM", "REFERRAL", "EXISTING_CUSTOMER", "FIELD_VISIT", "OTHER",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  GOOGLE_MAPS: "گوگل مپ", GOOGLE_SEARCH: "جستجوی گوگل", SNAPPFOOD: "اسنپ‌فود", TAPSI_FOOD: "تپسی‌فود",
  INSTAGRAM: "اینستاگرام", REFERRAL: "معرفی", EXISTING_CUSTOMER: "مشتری فعلی", FIELD_VISIT: "سر زدم", OTHER: "سایر",
};
export type SourceKind = "link" | "here" | "ref" | "other";
export const SOURCE_KIND: Record<LeadSource, SourceKind> = {
  GOOGLE_MAPS: "link", GOOGLE_SEARCH: "link", SNAPPFOOD: "link", TAPSI_FOOD: "link", INSTAGRAM: "link",
  REFERRAL: "ref", EXISTING_CUSTOMER: "ref", FIELD_VISIT: "here", OTHER: "other",
};
export const FOOD_APP_SOURCES: ReadonlySet<LeadSource> = new Set<LeadSource>(["SNAPPFOOD", "TAPSI_FOOD"]);

export const LOST_REASONS = [
  "PRICE_HIGH", "HAS_SUPPLIER", "QUALITY", "NO_NEED", "BUYS_FACTORY", "BUYS_DISTRIBUTOR", "PAYMENT_TERMS",
  "DELIVERY", "MOQ", "WRONG_CONTACT", "CLOSED", "SEASONAL", "COMPETITOR", "OTHER",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  PRICE_HIGH: "قیمت بالاست", HAS_SUPPLIER: "تأمین‌کننده دارد", QUALITY: "کیفیت", NO_NEED: "فعلاً نیاز ندارد",
  BUYS_FACTORY: "از کارخانه می‌خرد", BUYS_DISTRIBUTOR: "از پخش‌کننده می‌خرد", PAYMENT_TERMS: "شرایط پرداخت",
  DELIVERY: "مشکل ارسال", MOQ: "حداقل سفارش زیاد است", WRONG_CONTACT: "فرد اشتباه", CLOSED: "کسب‌وکار بسته شده",
  SEASONAL: "فصلی", COMPETITOR: "رابطه با رقیب", OTHER: "سایر",
};

export const SKIP_REASONS = ["WAITING_ON_THEM", "LOGGED_ELSEWHERE", "LEAD_LOST", "OTHER"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  WAITING_ON_THEM: "منتظر تماس خودش", LOGGED_ELSEWHERE: "کار دیگری ثبت کردم", LEAD_LOST: "سرنخ از دست رفت", OTHER: "سایر",
};

export const NOT_FIT_REASONS = ["NO_DAIRY", "TOO_SMALL", "READY_FOOD_ONLY", "OTHER"] as const;
export type NotFitReason = (typeof NOT_FIT_REASONS)[number];
export const NOT_FIT_LABEL: Record<NotFitReason, string> = {
  NO_DAIRY: "لبنیات و کره مصرف نمی‌کند", TOO_SMALL: "خیلی کوچک است", READY_FOOD_ONLY: "فقط غذای آماده می‌گیرد", OTHER: "سایر",
};

/** Task kinds a flow may create. Every one is labelled in lib/tasks/labels.ts. */
export const NEXT_KINDS = ["call", "visit", "verify_visit", "sample_delivery", "quote_followup", "outreach", "order"] as const;
export type NextKind = (typeof NEXT_KINDS)[number];
```

`lib/crm/phone.ts`

```ts
import { normalisePersian } from "@/lib/persian";

/** The last 10 digits of a phone, after Persian/Arabic digits become Latin. Iranian mobiles
 *  and Tehran landlines are both 10 significant digits, so +98 / 0 prefixes fall away and
 *  "09120001234", "+98 912 000 1234" and "۹۱۲۰۰۰۱۲۳۴" compare equal. */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = normalisePersian(raw).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function formatPhone(norm: string): string {
  return `0${norm.slice(0, 3)} ${norm.slice(3, 6)} ${norm.slice(6)}`;
}

export function telHref(norm: string): string {
  return `tel:0${norm}`;
}

export function normName(s: string): string {
  return normalisePersian(s).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

/** Same name, or one contains the other and the shorter is at least 6 letters -- enough
 *  that "کافه" alone never matches every café. */
export function namesAlike(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 6 && l.includes(s);
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/crm-vocab.test.ts` → PASS. If the Arabic-letter case fails, check `lib/persian.ts` `CHAR_MAP` maps `ك→ک` and `ي→ی`; if not, add both entries there (it is the app's single normaliser).
- [ ] **Step 5: Commit** — `git add lib/crm tests/crm-vocab.test.ts && git commit -m "feat(crm): vocabularies and phone/name normalisation"`

---

## Task 2: Stage, lifecycle and temperature

**Files:**
- Create: `lib/crm/stage.ts`, `lib/crm/temperature.ts`
- Test: `tests/crm-stage.test.ts`

**Interfaces:**
- Consumes: `SalesStage`, `Temperature` (Task 1); `CustomerLifecycle` (`lib/types.ts`).
- Produces: `stageRank(s): number`, `advanceStage(cur, next | null): SalesStage`, `lifecycleFor(stage, current): CustomerLifecycle`; `TempWindows`, `DEFAULT_WINDOWS`, `TempSignal`, `autoTemperature(signals, asOfIso, w?)`.

- [ ] **Step 1: Write the failing test** — `tests/crm-stage.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { advanceStage, lifecycleFor } from "@/lib/crm/stage";
import { autoTemperature } from "@/lib/crm/temperature";

describe("advanceStage", () => {
  it("only moves forward along the funnel", () => {
    expect(advanceStage("unknown", "interested")).toBe("interested");
    expect(advanceStage("sample", "interested")).toBe("sample");
    expect(advanceStage("interested", "negotiation")).toBe("negotiation");
    expect(advanceStage("interested", null)).toBe("interested");
  });
  it("lets a lead go cold, and a cold lead come back", () => {
    expect(advanceStage("negotiation", "not_interested")).toBe("not_interested");
    expect(advanceStage("not_interested", "interested")).toBe("interested");
    expect(advanceStage("lost", "sample")).toBe("sample");
  });
  it("never demotes a customer through a call outcome", () => {
    expect(advanceStage("customer", "not_interested")).toBe("customer");
    expect(advanceStage("first_order", "interested")).toBe("first_order");
    expect(advanceStage("first_order", "repeat_customer")).toBe("repeat_customer");
  });
});

describe("lifecycleFor", () => {
  it("derives the coarse lifecycle", () => {
    expect(lifecycleFor("unknown", "lead")).toBe("lead");
    expect(lifecycleFor("interested", "lead")).toBe("qualified");
    expect(lifecycleFor("sample", "qualified")).toBe("sampled");
    expect(lifecycleFor("first_order", "sampled")).toBe("active");
    expect(lifecycleFor("lost", "qualified")).toBe("lost");
  });
  it("keeps blocked always and dormant until a new order", () => {
    expect(lifecycleFor("customer", "blocked")).toBe("blocked");
    expect(lifecycleFor("interested", "dormant")).toBe("dormant");
    expect(lifecycleFor("repeat_customer", "dormant")).toBe("active");
  });
});

describe("autoTemperature", () => {
  const now = "2026-09-11T10:00:00.000Z";
  const daysAgo = (n: number) => new Date(Date.parse(now) - n * 86_400_000).toISOString();
  it("is cold with no signals", () => expect(autoTemperature([], now)).toBe("cold"));
  it("is hot for a recent hot signal, warm once it ages past 14 days", () => {
    expect(autoTemperature([{ at: daysAgo(3), signal: "hot" }], now)).toBe("hot");
    expect(autoTemperature([{ at: daysAgo(20), signal: "hot" }], now)).toBe("warm");
    expect(autoTemperature([{ at: daysAgo(40), signal: "hot" }], now)).toBe("cold");
  });
  it("lets the latest signal win", () => {
    expect(autoTemperature([{ at: daysAgo(5), signal: "hot" }, { at: daysAgo(1), signal: "cold" }], now)).toBe("cold");
  });
  it("ignores signals after asOf", () => {
    expect(autoTemperature([{ at: "2026-09-12T00:00:00.000Z", signal: "hot" }], now)).toBe("cold");
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-stage.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/crm/stage.ts`

```ts
import type { CustomerLifecycle } from "@/lib/types";
import type { SalesStage } from "./vocab";

const RANK: Record<SalesStage, number> = {
  unknown: 0, not_interested: 0, lost: 0,
  interested: 1, sample: 2, quotation: 3, negotiation: 4,
  first_order: 5, customer: 6, repeat_customer: 7,
};
export const stageRank = (s: SalesStage): number => RANK[s];

/** Forward-only, with two exceptions: a lead may go cold (not_interested / lost) at any
 *  point before its first order, and a cold lead may come back at any stage. A customer is
 *  never demoted by a call outcome -- that is what customer health is for. */
export function advanceStage(cur: SalesStage, next: SalesStage | null): SalesStage {
  if (!next || next === cur) return cur;
  const isCustomer = RANK[cur] >= 5;
  if (next === "not_interested" || next === "lost") return isCustomer ? cur : next;
  if (cur === "unknown" || cur === "not_interested" || cur === "lost") return next;
  return RANK[next] > RANK[cur] ? next : cur;
}

/** The lifecycle the 21 existing readers understand, derived from the finer stage.
 *  blocked is a credit decision and is never overwritten; dormant wakes only on an order. */
export function lifecycleFor(stage: SalesStage, current: CustomerLifecycle): CustomerLifecycle {
  if (current === "blocked") return current;
  if (current === "dormant" && RANK[stage] < 5) return current;
  switch (stage) {
    case "unknown":
    case "not_interested":
      return "lead";
    case "interested":
    case "quotation":
    case "negotiation":
      return "qualified";
    case "sample":
      return "sampled";
    case "lost":
      return "lost";
    default:
      return "active";
  }
}
```

`lib/crm/temperature.ts`

```ts
import type { Temperature } from "./vocab";

export interface TempWindows { hotDays: number; warmDays: number }
export const DEFAULT_WINDOWS: TempWindows = { hotDays: 14, warmDays: 30 };
export interface TempSignal { at: string; signal: Temperature }

const DAY = 86_400_000;

/** The latest signal inside the warm window decides. A hot signal older than the hot window
 *  cools to warm; nothing inside the warm window means cold. Misses carry no signal, so a
 *  no-answer after "asked for price" does not cool the lead. */
export function autoTemperature(signals: TempSignal[], asOfIso: string, w: TempWindows = DEFAULT_WINDOWS): Temperature {
  const now = Date.parse(asOfIso);
  let latest: TempSignal | null = null;
  for (const s of signals) {
    const t = Date.parse(s.at);
    if (t > now || now - t > w.warmDays * DAY) continue;
    if (!latest || t >= Date.parse(latest.at)) latest = s;
  }
  if (!latest) return "cold";
  if (latest.signal === "hot") return now - Date.parse(latest.at) <= w.hotDays * DAY ? "hot" : "warm";
  return latest.signal;
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-stage.test.ts` → PASS.
- [ ] **Step 5:** `git add lib/crm/stage.ts lib/crm/temperature.ts tests/crm-stage.test.ts && git commit -m "feat(crm): forward-only stage, derived lifecycle, auto temperature"`

---

## Task 3: Due times and working hours

**Files:**
- Create: `lib/crm/due.ts`, `lib/crm/hours.ts`
- Test: `tests/crm-due-hours.test.ts`

**Interfaces:**
- Consumes: `faDigits` (Task 1); `toJalali(iso): {jy,jm,jd} | null` from `lib/jalali.ts`.
- Produces: `DueSpec`, `TEHRAN_OFFSET_MIN`, `tehranParts(iso)`, `resolveDue(spec, nowIso, picked?)`, `labelDue(iso, nowIso)`; `HoursRange`, `WorkingHours`, `WEEKDAY_LABEL`, `isWorkingHours`, `parseHours`, `satIndex`, `isOpenAt(h, dow, minute)`, `nextOpenAt(h, iso)`, `formatHours(h)`.

- [ ] **Step 1: Write the failing test** — `tests/crm-due-hours.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveDue, labelDue, tehranParts } from "@/lib/crm/due";
import { isWorkingHours, parseHours, isOpenAt, nextOpenAt, formatHours } from "@/lib/crm/hours";

// 2026-09-11 10:00 UTC = 13:30 Tehran, a Friday (jsDow 5).
const NOW = "2026-09-11T10:00:00.000Z";

describe("resolveDue", () => {
  it("resolves wall-clock Tehran times", () => {
    expect(resolveDue({ kind: "tomorrow", hour: 10 }, NOW)).toBe("2026-09-12T06:30:00.000Z");
    expect(resolveDue({ kind: "in_days", days: 3, hour: 10 }, NOW)).toBe("2026-09-14T06:30:00.000Z");
    expect(resolveDue({ kind: "in_hours", hours: 2 }, NOW)).toBe("2026-09-11T12:00:00.000Z");
    expect(resolveDue({ kind: "in_months", months: 3, hour: 10 }, NOW)).toBe("2026-12-11T06:30:00.000Z");
    expect(resolveDue({ kind: "none" }, NOW)).toBeNull();
  });
  it("moves a today time that has already passed to an hour from now", () => {
    expect(resolveDue({ kind: "at_today", hour: 17 }, NOW)).toBe("2026-09-11T13:30:00.000Z");
    expect(resolveDue({ kind: "at_today", hour: 9 }, NOW)).toBe("2026-09-11T11:00:00.000Z");
  });
  it("uses a picked date and rejects a malformed one", () => {
    expect(resolveDue({ kind: "pick", hour: 10 }, NOW, "2026-09-20")).toBe("2026-09-20T06:30:00.000Z");
    expect(resolveDue({ kind: "pick", hour: 10 }, NOW, "20/9")).toBeNull();
  });
  it("labels relative to today", () => {
    expect(labelDue("2026-09-12T06:30:00.000Z", NOW)).toBe("فردا ۱۰:۰۰");
    expect(labelDue("2026-09-11T13:30:00.000Z", NOW)).toBe("امروز ۱۷:۰۰");
    expect(labelDue("2026-09-16T06:30:00.000Z", NOW)).toBe("۵ روز دیگر ۱۰:۰۰");
  });
  it("knows the Tehran weekday", () => expect(tehranParts(NOW).jsDow).toBe(5));
});

describe("working hours", () => {
  const split = [{ days: [0, 1, 2, 3, 4, 5, 6], from: "12:00", to: "16:00" }, { days: [0, 1, 2, 3, 4, 5, 6], from: "19:00", to: "24:00" }];
  it("validates", () => {
    expect(isWorkingHours(split)).toBe(true);
    expect(isWorkingHours([{ days: [], from: "12:00", to: "16:00" }])).toBe(false);
    expect(isWorkingHours([{ days: [0], from: "12:00", to: "12:00" }])).toBe(false);
    expect(isWorkingHours([{ days: [7], from: "12:00", to: "16:00" }])).toBe(false);
    expect(parseHours("not json")).toEqual([]);
  });
  it("answers open/closed, including overnight ranges", () => {
    expect(isOpenAt(split, 0, 13 * 60)).toBe(true);
    expect(isOpenAt(split, 0, 17 * 60)).toBe(false);
    const night = [{ days: [5], from: "19:00", to: "02:00" }];
    expect(isOpenAt(night, 5, 23 * 60)).toBe(true);
    expect(isOpenAt(night, 6, 60)).toBe(true);
    expect(isOpenAt(night, 6, 3 * 60)).toBe(false);
  });
  it("moves a due time to the next open slot", () => {
    // tomorrow 10:00 Tehran, shop opens at 12:00 -> 12:00 Tehran = 08:30 UTC
    expect(nextOpenAt(split, "2026-09-12T06:30:00.000Z")).toBe("2026-09-12T08:30:00.000Z");
    expect(nextOpenAt([], "2026-09-12T06:30:00.000Z")).toBe("2026-09-12T06:30:00.000Z");
  });
  it("formats in Persian and merges ranges that share days", () => {
    expect(formatHours(split)).toBe("همه‌روزه ۱۲–۱۶ و ۱۹–۲۴");
    expect(formatHours([{ days: [0, 1, 2, 3, 4], from: "08:30", to: "17:00" }])).toBe("شنبه تا چهارشنبه ۸:۳۰–۱۷");
    expect(formatHours([])).toBe("");
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-due-hours.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/crm/due.ts`

```ts
import { toJalali } from "@/lib/jalali";
import { faDigits } from "./vocab";

/** Tehran has kept +03:30 year-round since 2022. */
export const TEHRAN_OFFSET_MIN = 210;
const MIN = 60_000;

export type DueSpec =
  | { kind: "at_today"; hour: number }
  | { kind: "in_hours"; hours: number }
  | { kind: "tomorrow"; hour: number }
  | { kind: "in_days"; days: number; hour: number }
  | { kind: "in_months"; months: number; hour: number }
  | { kind: "pick"; hour: number }
  | { kind: "none" };

export function tehranParts(iso: string) {
  const t = new Date(Date.parse(iso) + TEHRAN_OFFSET_MIN * MIN);
  return { y: t.getUTCFullYear(), m0: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes(), jsDow: t.getUTCDay() };
}

/** A Tehran wall-clock moment as a UTC ISO string. Date.UTC normalises day/month overflow. */
function tehranWall(y: number, m0: number, d: number, h: number, min = 0): string {
  return new Date(Date.UTC(y, m0, d, h, min) - TEHRAN_OFFSET_MIN * MIN).toISOString();
}

export function resolveDue(spec: DueSpec, nowIso: string, picked?: string | null): string | null {
  const p = tehranParts(nowIso);
  switch (spec.kind) {
    case "none":
      return null;
    case "in_hours":
      return new Date(Date.parse(nowIso) + spec.hours * 60 * MIN).toISOString();
    case "at_today": {
      const at = tehranWall(p.y, p.m0, p.d, spec.hour);
      return Date.parse(at) > Date.parse(nowIso) ? at : new Date(Date.parse(nowIso) + 60 * MIN).toISOString();
    }
    case "tomorrow":
      return tehranWall(p.y, p.m0, p.d + 1, spec.hour);
    case "in_days":
      return tehranWall(p.y, p.m0, p.d + spec.days, spec.hour);
    case "in_months":
      return tehranWall(p.y, p.m0 + spec.months, p.d, spec.hour);
    case "pick": {
      if (!picked || !/^\d{4}-\d{2}-\d{2}$/.test(picked)) return null;
      const [y, m, d] = picked.split("-").map(Number);
      return tehranWall(y, m - 1, d, spec.hour);
    }
  }
}

export function labelDue(iso: string, nowIso: string): string {
  const a = tehranParts(nowIso);
  const b = tehranParts(iso);
  const n = Math.round((Date.UTC(b.y, b.m0, b.d) - Date.UTC(a.y, a.m0, a.d)) / 86_400_000);
  const time = faDigits(`${String(b.h).padStart(2, "0")}:${String(b.min).padStart(2, "0")}`);
  let day: string;
  if (n === 0) day = "امروز";
  else if (n === 1) day = "فردا";
  else if (n === 2) day = "پس‌فردا";
  else if (n > 2 && n < 14) day = `${faDigits(String(n))} روز دیگر`;
  else {
    const j = toJalali(iso);
    day = j ? faDigits(`${j.jd}/${j.jm}`) : faDigits(iso.slice(0, 10));
  }
  return `${day} ${time}`;
}
```

`lib/crm/hours.ts`

```ts
import { faDigits } from "./vocab";
import { tehranParts } from "./due";

/** days: 0 = شنبه … 6 = جمعه (the Iranian week). `to` may be earlier than `from` for a
 *  range that closes after midnight; "24:00" is allowed as a closing time. */
export interface HoursRange { days: number[]; from: string; to: string }
export type WorkingHours = HoursRange[];

export const WEEKDAY_LABEL = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const HHMM = /^([01]\d|2[0-4]):([0-5]\d)$/;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function isWorkingHours(v: unknown): v is WorkingHours {
  if (!Array.isArray(v) || v.length > 14) return false;
  return v.every((r) => {
    if (!r || typeof r !== "object") return false;
    const { days, from, to } = r as HoursRange;
    return (
      Array.isArray(days) && days.length > 0 && new Set(days).size === days.length &&
      days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
      typeof from === "string" && typeof to === "string" && HHMM.test(from) && HHMM.test(to) && from !== to
    );
  });
}

export function parseHours(json: string | null | undefined): WorkingHours {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return isWorkingHours(v) ? v : [];
  } catch {
    return [];
  }
}

/** Saturday-first index from JS getUTCDay() (0 = Sunday). */
export const satIndex = (jsDow: number): number => (jsDow + 1) % 7;

export function isOpenAt(h: WorkingHours, dow: number, minute: number): boolean {
  return h.some((r) => {
    const f = toMin(r.from);
    const t = toMin(r.to);
    if (f < t) return r.days.includes(dow) && minute >= f && minute < t;
    return (r.days.includes(dow) && minute >= f) || (r.days.includes((dow + 6) % 7) && minute < t);
  });
}

const QUARTER = 15 * 60_000;

/** The first moment at or after `iso` when the business is open; `iso` itself when hours
 *  are unknown or never open within a week. */
export function nextOpenAt(h: WorkingHours, iso: string): string {
  if (h.length === 0) return iso;
  const open = (ms: number) => {
    const p = tehranParts(new Date(ms).toISOString());
    return isOpenAt(h, satIndex(p.jsDow), p.h * 60 + p.min);
  };
  const start = Date.parse(iso);
  if (open(start)) return iso;
  let ms = Math.ceil(start / QUARTER) * QUARTER;
  for (let i = 0; i < 7 * 24 * 4; i++, ms += QUARTER) if (open(ms)) return new Date(ms).toISOString();
  return iso;
}

function daysLabel(days: number[]): string {
  const s = [...days].sort((a, b) => a - b).join(",");
  if (s === "0,1,2,3,4,5,6") return "همه‌روزه";
  if (s === "0,1,2,3,4") return "شنبه تا چهارشنبه";
  if (s === "0,1,2,3,4,5") return "به‌جز جمعه";
  return [...days].sort((a, b) => a - b).map((d) => WEEKDAY_LABEL[d]).join("، ");
}
const clock = (hhmm: string) => faDigits(hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : `${Number(hhmm.slice(0, 2))}:${hhmm.slice(3)}`);

export function formatHours(h: WorkingHours): string {
  const groups = new Map<string, HoursRange[]>();
  for (const r of h) {
    const key = [...r.days].sort((a, b) => a - b).join(",");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((rs) => `${daysLabel(rs[0].days)} ${rs.map((r) => `${clock(r.from)}–${clock(r.to)}`).join(" و ")}`)
    .join(" · ");
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-due-hours.test.ts` → PASS.
- [ ] **Step 5:** `git add lib/crm/due.ts lib/crm/hours.ts tests/crm-due-hours.test.ts && git commit -m "feat(crm): Tehran due times and working hours"`

---

## Task 4: Outcome facts and the replay

**Files:**
- Create: `lib/crm/outcomes.ts`, `lib/crm/replay.ts`
- Test: `tests/crm-replay.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `OUTCOME_CODES`, `OutcomeCode`, `OutcomeFacts`, `OUTCOMES: Record<OutcomeCode, OutcomeFacts>`; `ActivityFacts`, `CrmState`, `INITIAL_STATE`, `replayCrmState(acts, w?)`.

- [ ] **Step 1: Write the failing test** — `tests/crm-replay.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { OUTCOMES, OUTCOME_CODES } from "@/lib/crm/outcomes";
import { replayCrmState, INITIAL_STATE, type ActivityFacts } from "@/lib/crm/replay";

const act = (at: string, f: Partial<ActivityFacts>): ActivityFacts => ({
  occurred_at: at, contact_status_to: null, stage_to: null, verification_to: null, signal: null,
  attempt: 0, miss: 0, talked: 0, ...f,
});
const fromOutcome = (at: string, code: keyof typeof OUTCOMES): ActivityFacts => {
  const o = OUTCOMES[code];
  return act(at, { contact_status_to: o.contact_status, stage_to: o.stage, signal: o.signal, attempt: o.attempt ? 1 : 0, miss: o.miss ? 1 : 0, talked: o.talked ? 1 : 0 });
};

describe("OUTCOMES", () => {
  it("covers every code; a miss is always an attempt; a talk is never a miss", () => {
    for (const c of OUTCOME_CODES) {
      const o = OUTCOMES[c];
      expect(o).toBeTruthy();
      if (o.miss) expect(o.attempt).toBe(true);
      if (o.talked) expect(o.miss).toBe(false);
    }
  });
});

describe("replayCrmState", () => {
  it("starts from the initial state", () => expect(replayCrmState([])).toEqual(INITIAL_STATE));

  it("counts attempts and consecutive misses, and a talk resets the streak", () => {
    const s = replayCrmState([
      fromOutcome("2026-09-01T08:00:00.000Z", "NO_ANSWER"),
      fromOutcome("2026-09-02T08:00:00.000Z", "BUSY"),
      fromOutcome("2026-09-03T08:00:00.000Z", "ASKED_PRICE"),
      fromOutcome("2026-09-04T08:00:00.000Z", "NO_ANSWER"),
    ]);
    expect(s.attempt_count).toBe(4);
    expect(s.consecutive_misses).toBe(1);
    expect(s.contact_status).toBe("no_answer");
    expect(s.sales_stage).toBe("interested");
    expect(s.last_contacted_at).toBe("2026-09-03T08:00:00.000Z");
    expect(s.last_activity_at).toBe("2026-09-04T08:00:00.000Z");
    expect(s.temperature).toBe("hot");
  });

  it("folds verification and forward-only stages", () => {
    const s = replayCrmState([
      act("2026-09-01T08:00:00.000Z", { verification_to: "unverified" }),
      act("2026-09-02T08:00:00.000Z", { verification_to: "renamed", stage_to: "sample", talked: 1, contact_status_to: "contacted", attempt: 1 }),
      act("2026-09-03T08:00:00.000Z", { stage_to: "interested" }),
    ]);
    expect(s.verification).toBe("renamed");
    expect(s.sales_stage).toBe("sample");
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-replay.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/crm/outcomes.ts`

```ts
import type { ContactStatus, SalesStage, Temperature } from "./vocab";

/** What one answer to "how did it go?" means for the business's state. Existing codes
 *  (PRICE_OBJECTION, NOT_INTERESTED, ALREADY_SUPPLIED, PAYMENT_TERMS, QUALITY_DOUBT) are
 *  reused so the academy's objection cards keep matching tasks.outcome_code. */
export const OUTCOME_CODES = [
  "NO_ANSWER", "BUSY", "UNAVAILABLE", "WRONG_NUMBER", "TALKED", "CALL_BACK", "INTERESTED", "ASKED_PRICE",
  "REQUESTED_SAMPLE", "NEGOTIATING", "READY_TO_ORDER", "PRICE_OBJECTION", "PAYMENT_TERMS", "QUALITY_DOUBT",
  "ALREADY_SUPPLIED", "NOT_INTERESTED", "GATEKEEPER", "VISIT_CLOSED", "INVALID",
] as const;
export type OutcomeCode = (typeof OUTCOME_CODES)[number];

export interface OutcomeFacts {
  contact_status: ContactStatus | null;
  stage: SalesStage | null;
  signal: Temperature | null;
  attempt: boolean;
  miss: boolean;
  talked: boolean;
}

const miss = (s: ContactStatus): OutcomeFacts => ({ contact_status: s, stage: null, signal: null, attempt: true, miss: true, talked: false });
const talk = (stage: SalesStage | null, signal: Temperature | null): OutcomeFacts => ({ contact_status: "contacted", stage, signal, attempt: true, miss: false, talked: true });
const none: OutcomeFacts = { contact_status: null, stage: null, signal: null, attempt: false, miss: false, talked: false };

export const OUTCOMES: Record<OutcomeCode, OutcomeFacts> = {
  NO_ANSWER: miss("no_answer"),
  BUSY: miss("busy"),
  UNAVAILABLE: miss("unavailable"),
  WRONG_NUMBER: miss("wrong_number"),
  TALKED: talk(null, null),
  CALL_BACK: talk(null, "warm"),
  INTERESTED: talk("interested", "warm"),
  ASKED_PRICE: talk("interested", "hot"),
  REQUESTED_SAMPLE: talk("sample", "hot"),
  NEGOTIATING: talk("negotiation", "hot"),
  READY_TO_ORDER: talk("negotiation", "hot"),
  PRICE_OBJECTION: talk(null, "warm"),
  PAYMENT_TERMS: talk(null, "warm"),
  QUALITY_DOUBT: talk(null, "warm"),
  ALREADY_SUPPLIED: talk(null, "warm"),
  NOT_INTERESTED: talk("not_interested", "cold"),
  GATEKEEPER: talk(null, null),
  VISIT_CLOSED: none,
  INVALID: none,
};
```

`lib/crm/replay.ts`

```ts
import { advanceStage } from "./stage";
import { autoTemperature, DEFAULT_WINDOWS, type TempSignal, type TempWindows } from "./temperature";
import type { ContactStatus, SalesStage, Temperature, Verification } from "./vocab";

/** The columns of one activities row the replay folds. Stored on the row itself, so the
 *  replay never re-derives them from outcome codes whose meaning may change later. */
export interface ActivityFacts {
  occurred_at: string;
  contact_status_to: ContactStatus | null;
  stage_to: SalesStage | null;
  verification_to: Verification | null;
  signal: Temperature | null;
  attempt: number;
  miss: number;
  talked: number;
}

export interface CrmState {
  contact_status: ContactStatus;
  sales_stage: SalesStage;
  verification: Verification;
  temperature: Temperature;
  attempt_count: number;
  consecutive_misses: number;
  last_activity_at: string | null;
  last_contacted_at: string | null;
}

export const INITIAL_STATE: CrmState = {
  contact_status: "not_contacted", sales_stage: "unknown", verification: "unverified", temperature: "cold",
  attempt_count: 0, consecutive_misses: 0, last_activity_at: null, last_contacted_at: null,
};

/** The cached columns on customers are exactly this fold over the business's activities in
 *  (occurred_at, id) order. Temperature is evaluated as of the last activity, so the result
 *  is deterministic; a later sweep may cool it as time passes. */
export function replayCrmState(acts: ActivityFacts[], w: TempWindows = DEFAULT_WINDOWS): CrmState {
  const s: CrmState = { ...INITIAL_STATE };
  const signals: TempSignal[] = [];
  for (const a of acts) {
    if (a.contact_status_to) s.contact_status = a.contact_status_to;
    s.sales_stage = advanceStage(s.sales_stage, a.stage_to);
    if (a.verification_to) s.verification = a.verification_to;
    if (a.signal) signals.push({ at: a.occurred_at, signal: a.signal });
    if (a.attempt) s.attempt_count += 1;
    if (a.miss) s.consecutive_misses += 1;
    else if (a.talked) s.consecutive_misses = 0;
    if (a.talked) s.last_contacted_at = a.occurred_at;
    s.last_activity_at = a.occurred_at;
  }
  if (s.last_activity_at) s.temperature = autoTemperature(signals, s.last_activity_at, w);
  return s;
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-replay.test.ts` → PASS.
- [ ] **Step 5:** `git add lib/crm/outcomes.ts lib/crm/replay.ts tests/crm-replay.test.ts && git commit -m "feat(crm): outcome facts and the state replay"`

---

## Task 5: The flow engine (types, machine, validator)

**Files:**
- Create: `lib/crm/flows/types.ts`, `lib/crm/flows/machine.ts`, `lib/crm/flows/validate.ts`
- Test: `tests/crm-flow-machine.test.ts`

**Interfaces:**
- Consumes: vocab, `OutcomeCode`, `DueSpec`.
- Produces (exact names later tasks use):
  - types: `StepKind`, `FlowSet`, `FlowOption`, `FlowStep`, `FlowConfig`, `FlowContext`, `EMPTY_CONTEXT`, `FlowAnswer`, `FlowState`, `FlowProgress`, `ResolvedOption`, `ResolvedStep`
  - machine: `FlowError`, `SKIP`, `startFlow(cfg, ctx)`, `viewStep(cfg, ctx, st)`, `answerStep(cfg, ctx, st, optionId, value?)`, `backStep(cfg, ctx, st)`, `replayAnswers(cfg, ctx, answers)`, `interpolate(text, ctx, acc)`
  - validate: `FlowVariant`, `FlowReport`, `checkFlow(cfg, variants)`

- [ ] **Step 1: Write the failing test** — `tests/crm-flow-machine.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { FlowConfig } from "@/lib/crm/flows/types";
import { EMPTY_CONTEXT } from "@/lib/crm/flows/types";
import { startFlow, viewStep, answerStep, backStep, replayAnswers, FlowError, SKIP } from "@/lib/crm/flows/machine";
import { checkFlow } from "@/lib/crm/flows/validate";

const cfg: FlowConfig = {
  id: "t",
  start: () => "a",
  skipStep: "skip",
  budget: { common: 3, longest: 4 },
  steps: {
    a: { id: "a", kind: "choice", q: "سلام {name}", options: [
      { id: "x", label: "ایکس", next: "b", set: { outcome: "TALKED" } },
      { id: "y", label: "وای", next: (_c, s) => (s.acc.outcome === "TALKED" ? "b" : "c") },
    ] },
    b: { id: "b", kind: "input", q: "نام", input: { field: "new_name", placeholder: "…" }, options: [{ id: "ok", label: "ادامه", next: "c" }] },
    c: { id: "c", kind: "choice", q: "کی؟", timeStep: true, options: [
      { id: "t1", label: "فردا", save: true, set: { due: { kind: "tomorrow", hour: 10 }, next_title: "تماس" } },
    ] },
    skip: { id: "skip", kind: "choice", q: "چرا؟", options: [{ id: "s", label: "سایر", save: true, set: { skip_reason: "OTHER", due: { kind: "none" } } }] },
  },
};
const ctx = { ...EMPTY_CONTEXT, vars: { name: "علی" } };

describe("machine", () => {
  it("renders interpolated questions", () => {
    expect(viewStep(cfg, ctx, startFlow(cfg, ctx)).q).toBe("سلام علی");
  });
  it("walks, merges sets, stores input values and saves on a save option", () => {
    let st = startFlow(cfg, ctx);
    st = answerStep(cfg, ctx, st, "x");
    st = answerStep(cfg, ctx, st, "ok", "کافه نو");
    expect(st.values.new_name).toBe("کافه نو");
    st = answerStep(cfg, ctx, st, "t1");
    expect(st.saved).toBe(true);
    expect(st.acc).toMatchObject({ outcome: "TALKED", next_title: "تماس" });
    expect(() => answerStep(cfg, ctx, st, "t1")).toThrow(FlowError);
  });
  it("requires a value for a required input", () => {
    const st = answerStep(cfg, ctx, startFlow(cfg, ctx), "x");
    expect(() => answerStep(cfg, ctx, st, "ok")).toThrow(FlowError);
  });
  it("routes through a next function and a skip", () => {
    let st = answerStep(cfg, ctx, startFlow(cfg, ctx), "y");
    expect(st.stack.at(-1)).toBe("c");
    st = answerStep(cfg, ctx, st, SKIP);
    expect(st.stack.at(-1)).toBe("skip");
    st = answerStep(cfg, ctx, st, "s");
    expect(st.acc.skip_reason).toBe("OTHER");
  });
  it("goes back one step keeping earlier answers", () => {
    let st = answerStep(cfg, ctx, startFlow(cfg, ctx), "x");
    st = answerStep(cfg, ctx, st, "ok", "کافه نو");
    st = backStep(cfg, ctx, st);
    expect(st.stack.at(-1)).toBe("b");
    expect(st.acc.outcome).toBe("TALKED");
  });
  it("replays answers and rejects an answer for the wrong step", () => {
    const st = replayAnswers(cfg, ctx, [{ step: "a", option: "y" }, { step: "c", option: "t1" }]);
    expect(st.saved).toBe(true);
    expect(() => replayAnswers(cfg, ctx, [{ step: "c", option: "t1" }])).toThrow(FlowError);
  });
});

describe("checkFlow", () => {
  it("measures shortest and longest save paths", () => {
    const r = checkFlow(cfg, [{ ctx, values: { b: "کافه" } }]);
    expect(r.deadEnds).toEqual([]);
    expect(r.shortest).toBe(2);
    expect(r.longest).toBe(3);
  });
  it("reports an option that goes nowhere", () => {
    const broken: FlowConfig = { ...cfg, steps: { ...cfg.steps, a: { ...cfg.steps.a, options: [{ id: "z", label: "ز", next: "missing" }] } } };
    expect(checkFlow(broken, [{ ctx, values: {} }]).deadEnds.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-flow-machine.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/crm/flows/types.ts`

```ts
import type { DueSpec } from "../due";
import type { OutcomeCode } from "../outcomes";
import type {
  BusinessType, ContactRole, LeadSource, LostReason, NextKind, NotFitReason, PriceTier, SkipReason, Verification,
} from "../vocab";

export type StepKind = "choice" | "multi" | "input" | "roles" | "basics" | "link" | "pin" | "hours";

/** Everything an answer can contribute. Merged left to right; a later answer wins. */
export interface FlowSet {
  outcome?: OutcomeCode;
  verification?: Verification;
  contact_id?: number;
  contact_role?: ContactRole;
  decider_role?: ContactRole;
  next_kind?: NextKind;
  next_title?: string;
  due?: DueSpec;
  next_assignee?: "owner" | "group_manager" | "driver_pool";
  lost_reason?: LostReason;
  not_fit?: NotFitReason;
  skip_reason?: SkipReason;
  invalid?: boolean;
  source?: LeadSource;
  business_type?: BusinessType;
  price_tier?: PriceTier;
  owner?: "me" | "pool" | number;
  referred_by?: number;
  pin_mode?: "gps" | "map";
  product_id?: number;
  sample_qty?: string;
  share?: "whatsapp" | "telegram";
  redial?: boolean;
  open_order?: boolean;
  spawn_lead?: boolean;
  handoff?: "talked_now";
}

export interface FlowProgress { acc: FlowSet; values: Record<string, string> }
export type NextFn = (ctx: FlowContext, s: FlowProgress) => string;
type Dyn<T> = T | ((ctx: FlowContext, s: FlowProgress) => T);

export interface FlowOption {
  id: string;
  label: string;
  sub?: string;
  tone?: "rec" | "bad";
  group?: string;
  next?: string | NextFn;
  save?: boolean;
  set?: FlowSet;
}

export interface FlowInput { field: string; placeholder: string; ltr?: boolean; optional?: boolean }

export interface FlowStep {
  id: string;
  kind: StepKind;
  q: string;
  sub?: Dyn<string>;
  options: Dyn<FlowOption[]>;
  /** multi steps: the toggles; the answer value is their ids joined by ",". */
  choices?: Dyn<{ id: string; label: string }[]>;
  input?: FlowInput;
  timeStep?: boolean;
}

export interface FlowConfig {
  id: string;
  start: (ctx: FlowContext) => string;
  steps: Record<string, FlowStep>;
  skipStep?: string;
  budget: { common: number; longest: number };
}

export interface FlowContext {
  entry: "call" | "talked_now" | "add_lead" | "driver_visit";
  firstContact: boolean;
  attemptNo: number;
  maxMisses: number;
  isManager: boolean;
  vars: Record<string, string>;
  knownContacts: { id: number; name: string | null; role: ContactRole }[];
  products: { id: number; name: string; price_toman: number | null }[];
  reps: { id: number; name: string; open: number }[];
  recentCustomers: { id: number; name: string }[];
}

export const EMPTY_CONTEXT: FlowContext = {
  entry: "call", firstContact: false, attemptNo: 1, maxMisses: 5, isManager: false,
  vars: {}, knownContacts: [], products: [], reps: [], recentCustomers: [],
};

export interface FlowAnswer { step: string; option: string; value?: string }
export interface FlowState { stack: string[]; answers: FlowAnswer[]; acc: FlowSet; values: Record<string, string>; saved: boolean }

export interface ResolvedOption { id: string; label: string; sub?: string; tone?: "rec" | "bad"; group?: string; due?: DueSpec; saves: boolean }
export interface ResolvedStep {
  id: string; kind: StepKind; q: string; sub?: string; options: ResolvedOption[];
  choices: { id: string; label: string }[]; input?: FlowInput; timeStep: boolean;
}
```

`lib/crm/flows/machine.ts`

```ts
import { CONTACT_ROLE_LABEL, faDigits } from "../vocab";
import type { FlowAnswer, FlowConfig, FlowContext, FlowOption, FlowSet, FlowState, FlowStep, ResolvedStep } from "./types";

export class FlowError extends Error {}
/** The option id a time step's «بدون کار بعدی…» sends. */
export const SKIP = "__skip";

function stepOf(cfg: FlowConfig, id: string): FlowStep {
  const s = cfg.steps[id];
  if (!s) throw new FlowError(`unknown step ${id}`);
  return s;
}
const dyn = <T>(v: T | ((c: FlowContext, s: { acc: FlowSet; values: Record<string, string> }) => T), ctx: FlowContext, st: FlowState): T =>
  typeof v === "function" ? (v as (c: FlowContext, s: { acc: FlowSet; values: Record<string, string> }) => T)(ctx, { acc: st.acc, values: st.values }) : v;
const optionsOf = (step: FlowStep, ctx: FlowContext, st: FlowState): FlowOption[] => dyn(step.options, ctx, st);

export function interpolate(text: string, ctx: FlowContext, acc: FlowSet): string {
  const vars: Record<string, string> = {
    ...ctx.vars,
    attempt: faDigits(String(ctx.attemptNo)),
    max: faDigits(String(ctx.maxMisses)),
    decider: acc.decider_role ? CONTACT_ROLE_LABEL[acc.decider_role] : "",
    role: acc.contact_role ? CONTACT_ROLE_LABEL[acc.contact_role] : "",
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function startFlow(cfg: FlowConfig, ctx: FlowContext): FlowState {
  const first = cfg.start(ctx);
  stepOf(cfg, first);
  return { stack: [first], answers: [], acc: {}, values: {}, saved: false };
}

export function viewStep(cfg: FlowConfig, ctx: FlowContext, st: FlowState): ResolvedStep {
  const step = stepOf(cfg, st.stack[st.stack.length - 1]);
  const sub = step.sub === undefined ? undefined : dyn(step.sub, ctx, st);
  return {
    id: step.id,
    kind: step.kind,
    q: interpolate(step.q, ctx, st.acc),
    sub: sub ? interpolate(sub, ctx, st.acc) : undefined,
    options: optionsOf(step, ctx, st).map((o) => ({
      id: o.id,
      label: interpolate(o.label, ctx, st.acc),
      sub: o.sub ? interpolate(o.sub, ctx, st.acc) : undefined,
      tone: o.tone,
      group: o.group,
      due: o.set?.due,
      saves: o.save === true,
    })),
    choices: step.choices ? dyn(step.choices, ctx, st) : [],
    input: step.input,
    timeStep: !!step.timeStep && !!cfg.skipStep,
  };
}

export function answerStep(cfg: FlowConfig, ctx: FlowContext, st: FlowState, optionId: string, value?: string): FlowState {
  if (st.saved) throw new FlowError("flow already saved");
  const stepId = st.stack[st.stack.length - 1];
  const step = stepOf(cfg, stepId);

  if (optionId === SKIP) {
    if (!step.timeStep || !cfg.skipStep) throw new FlowError(`no skip at ${stepId}`);
    return { ...st, stack: [...st.stack, cfg.skipStep], answers: [...st.answers, { step: stepId, option: SKIP }] };
  }

  const opt = optionsOf(step, ctx, st).find((o) => o.id === optionId);
  if (!opt) throw new FlowError(`unknown option ${optionId} at ${stepId}`);

  const key = step.input?.field ?? stepId;
  const values = { ...st.values };
  const has = value !== undefined && value !== "";
  if (has) values[key] = value as string;
  else if (step.kind === "input" && step.input && !step.input.optional) throw new FlowError(`${key} is required`);

  const acc: FlowSet = { ...st.acc, ...(opt.set ?? {}) };
  const answer: FlowAnswer = has ? { step: stepId, option: optionId, value } : { step: stepId, option: optionId };
  const answers = [...st.answers, answer];
  if (opt.save) return { stack: st.stack, answers, acc, values, saved: true };

  const nextId = typeof opt.next === "function" ? opt.next(ctx, { acc, values }) : opt.next;
  if (!nextId) throw new FlowError(`option ${optionId} at ${stepId} neither saves nor continues`);
  stepOf(cfg, nextId);
  return { stack: [...st.stack, nextId], answers, acc, values, saved: false };
}

export function replayAnswers(cfg: FlowConfig, ctx: FlowContext, answers: FlowAnswer[]): FlowState {
  let st = startFlow(cfg, ctx);
  for (const a of answers) {
    const cur = st.stack[st.stack.length - 1];
    if (a.step !== cur) throw new FlowError(`answer for ${a.step} but the flow is at ${cur}`);
    st = answerStep(cfg, ctx, st, a.option, a.value);
  }
  return st;
}

/** Up one step, keeping every earlier answer -- also how undo reopens the last question. */
export function backStep(cfg: FlowConfig, ctx: FlowContext, st: FlowState): FlowState {
  if (st.answers.length === 0) return st;
  return replayAnswers(cfg, ctx, st.answers.slice(0, -1));
}
```

`lib/crm/flows/validate.ts`

```ts
import { answerStep, startFlow, viewStep } from "./machine";
import type { FlowConfig, FlowContext, FlowState } from "./types";

/** One context to walk the flow under, plus the value each input/custom step receives. */
export interface FlowVariant { ctx: FlowContext; values: Record<string, string> }
export interface FlowReport { deadEnds: string[]; shortest: number; longest: number }

/** Every answer sequence, depth-first. A step already on the current path is not
 *  re-entered (a "put me through" loop's exits are explored from its first visit), and the
 *  skip escape is not counted -- it is checked by asserting the skip step saves. */
export function checkFlow(cfg: FlowConfig, variants: FlowVariant[]): FlowReport {
  const deadEnds = new Set<string>();
  let shortest = Infinity;
  let longest = 0;
  for (const v of variants) {
    const walk = (st: FlowState, depth: number, seen: string[]) => {
      if (depth > 20) {
        deadEnds.add(`too deep: ${seen.join(">")}`);
        return;
      }
      const view = viewStep(cfg, v.ctx, st);
      if (view.options.length === 0) {
        deadEnds.add(`no options at ${view.id}`);
        return;
      }
      for (const o of view.options) {
        let next: FlowState;
        try {
          next = answerStep(cfg, v.ctx, st, o.id, v.values[view.id]);
        } catch (e) {
          deadEnds.add(`${view.id}.${o.id}: ${(e as Error).message}`);
          continue;
        }
        if (next.saved) {
          shortest = Math.min(shortest, depth + 1);
          longest = Math.max(longest, depth + 1);
          continue;
        }
        const to = next.stack[next.stack.length - 1];
        if (seen.includes(to)) continue;
        walk(next, depth + 1, [...seen, to]);
      }
    };
    const st0 = startFlow(cfg, v.ctx);
    walk(st0, 0, [st0.stack[0]]);
  }
  return { deadEnds: [...deadEnds], shortest, longest };
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-flow-machine.test.ts` → PASS.
- [ ] **Step 5:** `git add lib/crm/flows tests/crm-flow-machine.test.ts && git commit -m "feat(crm): tap-flow machine and validator"`

---

## Task 6: The three flow configs

**Files:**
- Create: `lib/crm/flows/common.ts`, `lib/crm/flows/afterCall.ts`, `lib/crm/flows/addLead.ts`, `lib/crm/flows/driverVisit.ts`
- Test: `tests/crm-flow-configs.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 5.
- Produces: `TOMORROW_10`, `timeOptions`, `PICK`, `roleOptions`, `SKIP_STEP`; `afterCallFlow`; `addLeadFlow`, `BasicsValue`, `PinValue`, `LinkValue`, `basicsOf`, `linkOf`, `pinOf`, `hoursOf`, `hasPhone`; `driverVisitFlow`.

- [ ] **Step 1: Write the failing test** — `tests/crm-flow-configs.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowConfig, type FlowContext } from "@/lib/crm/flows/types";
import { checkFlow, type FlowVariant } from "@/lib/crm/flows/validate";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { addLeadFlow, pinOf, basicsOf, hasPhone } from "@/lib/crm/flows/addLead";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";

const PIN = JSON.stringify({ lat: 35.76, lng: 51.41, precision: "exact" });
const base: FlowContext = {
  ...EMPTY_CONTEXT,
  vars: { name: "کبابی نمونه", source: "گوگل مپ", contact: "علی · مسئول خرید", address: "ونک" },
  knownContacts: [{ id: 7, name: "علی", role: "PURCHASING" }],
  products: [{ id: 1, name: "کره ۱۰ گرمی", price_toman: 1000 }, { id: 2, name: "پودر کاکائو", price_toman: null }],
  reps: [{ id: 11, name: "فاطمه", open: 30 }, { id: 12, name: "نازنین", open: 8 }],
  recentCustomers: [{ id: 3, name: "رستوران نایب" }],
};
const callValues = { newnum: "09120001234", rename: "کافه نو", movedpin: PIN, who: "رضا", prods: "1,2" };

function assertBudget(cfg: FlowConfig, variants: FlowVariant[]) {
  const r = checkFlow(cfg, variants);
  expect(r.deadEnds).toEqual([]);
  expect(r.shortest).toBeLessThanOrEqual(cfg.budget.common);
  expect(r.longest).toBeLessThanOrEqual(cfg.budget.longest);
  const skip = cfg.skipStep ? cfg.steps[cfg.skipStep] : null;
  if (skip && Array.isArray(skip.options)) for (const o of skip.options) expect(o.save).toBe(true);
}

describe("after-call flow", () => {
  it("has no dead ends and stays inside its budget in every context", () => {
    assertBudget(afterCallFlow, [
      { ctx: { ...base, firstContact: true, knownContacts: [] }, values: callValues },
      { ctx: { ...base, firstContact: false }, values: callValues },
      { ctx: { ...base, firstContact: true, attemptNo: 5 }, values: callValues },
      { ctx: { ...base, entry: "talked_now" }, values: callValues },
    ]);
  });
  it("asks a first call to verify the lead before anything else", () => {
    const ctx = { ...base, firstContact: true };
    const st = answerStep(afterCallFlow, ctx, startFlow(afterCallFlow, ctx), "talked");
    expect(st.stack.at(-1)).toBe("verify");
  });
  it("offers known contacts first, then roles grouped by decider/staff", () => {
    const ctx = { ...base, entry: "talked_now" as const };
    const v = viewStep(afterCallFlow, ctx, startFlow(afterCallFlow, ctx));
    expect(v.options[0]).toMatchObject({ id: "c7", label: "علی" });
    expect(new Set(v.options.slice(1).map((o) => o.group))).toEqual(new Set(["تصمیم‌گیرنده", "کارکنان"]));
  });
  it("a missed call can be saved in two taps", () => {
    let st = startFlow(afterCallFlow, base);
    st = answerStep(afterCallFlow, base, st, "no_answer");
    st = answerStep(afterCallFlow, base, st, "t10");
    expect(st.saved).toBe(true);
    expect(st.acc).toMatchObject({ outcome: "NO_ANSWER", next_kind: "call" });
  });
});

describe("add-lead flow", () => {
  const withPhone = { link: JSON.stringify({ name: "کافه نو", lat: 35.7, lng: 51.4, address: "ونک", maps_url: "https://maps.app.goo.gl/x" }),
    basics: JSON.stringify({ name: "کافه نو", phone: "09120001234", branch_of: null }), pin: PIN, here: PIN, hours: "[]", refname: "علی", other: "نمایشگاه" };
  const noPhoneNoPin = { ...withPhone, link: JSON.stringify({ name: null, lat: null, lng: null, address: null, maps_url: "https://x" }),
    basics: JSON.stringify({ name: "کافه نو", phone: "", branch_of: null }), here: "" };
  it("has no dead ends and stays inside its budget", () => {
    assertBudget(addLeadFlow, [
      { ctx: { ...base, entry: "add_lead" }, values: withPhone },
      { ctx: { ...base, entry: "add_lead", isManager: true }, values: withPhone },
      { ctx: { ...base, entry: "add_lead" }, values: noPhoneNoPin },
    ]);
  });
  it("sends a phone-less lead to a verification visit, never a call", () => {
    const ctx = { ...base, entry: "add_lead" as const };
    let st = startFlow(addLeadFlow, ctx);
    st = answerStep(addLeadFlow, ctx, st, "SNAPPFOOD");
    st = answerStep(addLeadFlow, ctx, st, "nolink", noPhoneNoPin.link);
    st = answerStep(addLeadFlow, ctx, st, "ok", noPhoneNoPin.basics);
    expect(st.stack.at(-1)).toBe("loc");
    st = answerStep(addLeadFlow, ctx, st, "map");
    st = answerStep(addLeadFlow, ctx, st, "ok", JSON.stringify({ lat: 35.7, lng: 51.4, precision: "approx" }));
    st = answerStep(addLeadFlow, ctx, st, "CAFE");
    st = answerStep(addLeadFlow, ctx, st, "mid");
    st = answerStep(addLeadFlow, ctx, st, "skip");
    const first = viewStep(addLeadFlow, ctx, st);
    expect(first.options.map((o) => o.id)).toEqual(["driver", "self", "talked"]);
  });
  it("reads values: the explicit pin beats the link's", () => {
    expect(pinOf({ link: withPhone.link, pin: JSON.stringify({ lat: 35.8, lng: 51.5, precision: "approx" }) })).toMatchObject({ lat: 35.8, precision: "approx" });
    expect(pinOf({ link: noPhoneNoPin.link })).toBeNull();
    expect(pinOf({ pin: JSON.stringify({ lat: 0, lng: 0, precision: "exact" }) })).toBeNull();
    expect(basicsOf(withPhone)?.name).toBe("کافه نو");
    expect(hasPhone(withPhone)).toBe(true);
    expect(hasPhone(noPhoneNoPin)).toBe(false);
  });
});

describe("driver visit flow", () => {
  it("is five taps on the common path and has no dead ends", () => {
    assertBudget(driverVisitFlow, [{ ctx: { ...base, entry: "driver_visit" }, values: { phone: "09120001234", who: "" } }]);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-flow-configs.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/crm/flows/common.ts`

```ts
import type { DueSpec } from "../due";
import { CONTACT_ROLES, CONTACT_ROLE_LABEL, isDecider, SKIP_REASONS, SKIP_REASON_LABEL, type ContactRole, type NextKind } from "../vocab";
import type { FlowOption, FlowSet, FlowStep } from "./types";

export const TOMORROW_10: DueSpec = { kind: "tomorrow", hour: 10 };
export interface TimeChoice { id: string; label: string; due: DueSpec; rec?: boolean }
export const PICK = (label = "روز دیگر…"): TimeChoice => ({ id: "pick", label, due: { kind: "pick", hour: 10 } });

/** A time question's answers: each one saves, carrying the next action's title and kind. */
export function timeOptions(title: string, kind: NextKind, choices: TimeChoice[], extra: FlowSet = {}): FlowOption[] {
  return choices.map((c) => ({
    id: c.id, label: c.label, sub: c.rec ? "پیشنهادی" : undefined, tone: c.rec ? "rec" : undefined, save: true,
    set: { next_title: title, next_kind: kind, due: c.due, ...extra },
  }));
}

const ROLE_ORDER: ContactRole[] = CONTACT_ROLES.filter((r) => r !== "OTHER");

/** "Who did you talk to?" -- roles, decision-makers first; nobody is known on a first call. */
export function roleOptions(deciderNext: string, staffNext: string): FlowOption[] {
  return ROLE_ORDER.map((r) => ({
    id: r, label: CONTACT_ROLE_LABEL[r], group: isDecider(r) ? "تصمیم‌گیرنده" : "کارکنان",
    next: isDecider(r) ? deciderNext : staffNext, set: { contact_role: r },
  }));
}

export const SKIP_STEP: FlowStep = {
  id: "skip", kind: "choice", q: "چرا کار بعدی ندارد؟",
  options: SKIP_REASONS.map((r) => ({ id: r, label: SKIP_REASON_LABEL[r], save: true, set: { skip_reason: r, due: { kind: "none" } } })),
};
```

`lib/crm/flows/afterCall.ts`

```ts
import { CONTACT_ROLE_LABEL, isDecider, LOST_REASON_LABEL, NOT_FIT_LABEL, NOT_FIT_REASONS, type LostReason } from "../vocab";
import { PICK, roleOptions, SKIP_STEP, timeOptions, TOMORROW_10 } from "./common";
import type { FlowConfig, FlowContext, FlowOption } from "./types";

const knownContacts = (ctx: FlowContext): FlowOption[] =>
  ctx.knownContacts.map((c) => ({
    id: `c${c.id}`, label: c.name ?? CONTACT_ROLE_LABEL[c.role], sub: `${CONTACT_ROLE_LABEL[c.role]} · آشنا`, tone: "rec",
    // A migrated contact has role OTHER (we never knew it); treat them as the right person.
    next: c.role === "OTHER" || isDecider(c.role) ? "what" : "gate", set: { contact_id: c.id, contact_role: c.role },
  }));

const WHY: LostReason[] = ["PRICE_HIGH", "HAS_SUPPLIER", "NO_NEED", "BUYS_FACTORY", "QUALITY", "PAYMENT_TERMS", "OTHER"];
const AGAIN = "تماس دوباره";
const INVALID_END = { outcome: "INVALID", invalid: true, due: { kind: "none" } } as const;

export const afterCallFlow: FlowConfig = {
  id: "after_call",
  start: (ctx) => (ctx.entry === "talked_now" ? "who" : "reach"),
  skipStep: "skip",
  budget: { common: 5, longest: 9 },
  steps: {
    reach: {
      id: "reach", kind: "choice", q: "تماس چطور بود؟",
      sub: (ctx) => (ctx.firstContact ? "تماس اول · {source}، هنوز تأیید نشده" : "{contact}"),
      options: [
        { id: "talked", label: "صحبت کردیم", next: (ctx) => (ctx.firstContact ? "verify" : "who"), set: { outcome: "TALKED" } },
        { id: "no_answer", label: "جواب نداد", next: "noans", set: { outcome: "NO_ANSWER" } },
        { id: "busy", label: "مشغول بود", next: "noans", set: { outcome: "BUSY" } },
        { id: "unavailable", label: "خاموش / در دسترس نیست", next: "noans", set: { outcome: "UNAVAILABLE" } },
        { id: "wrong", label: "شماره اشتباه / قطع است", tone: "bad", next: "wrong", set: { outcome: "WRONG_NUMBER" } },
      ],
    },
    noans: {
      id: "noans", kind: "choice", q: "کی دوباره زنگ بزنیم؟", timeStep: true,
      sub: (ctx) => (ctx.firstContact ? "تلاش {attempt} از {max} برای تأیید سرنخ" : "تلاش {attempt} بی‌پاسخ"),
      options: (ctx) => {
        const tired = ctx.attemptNo >= ctx.maxMisses;
        const times = tired
          ? timeOptions("تماس دوباره پس از وقفه", "call", [{ id: "park", label: "۳۰ روز دیگر", due: { kind: "in_days", days: 30, hour: 10 }, rec: true }])
          : timeOptions(AGAIN, "call", [
              { id: "t10", label: "فردا ۱۰:۰۰", due: TOMORROW_10, rec: true },
              { id: "h2", label: "۲ ساعت دیگر", due: { kind: "in_hours", hours: 2 } },
              { id: "t17", label: "فردا عصر", due: { kind: "tomorrow", hour: 17 } },
              PICK(),
            ]);
        const visits: FlowOption[] = ctx.firstContact || tired
          ? [
              { id: "visit", label: "خودم سر می‌زنم", sub: "به مسیر فردا", save: true, set: { next_title: "بازدید برای تأیید", next_kind: "visit", due: { kind: "tomorrow", hour: 11 } } },
              { id: "driver", label: "راننده سر بزند", sub: "در مسیر بعدی راننده", save: true, set: { next_title: "بازدید تأیید", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "tomorrow", hour: 9 } } },
            ]
          : [];
        return [...times, ...visits];
      },
    },
    wrong: {
      id: "wrong", kind: "choice", q: "شمارهٔ درست را دارید؟",
      options: [
        { id: "new", label: "بله، شمارهٔ جدید", next: "newnum" },
        { id: "later", label: "نه، بعداً پیدا می‌کنم", save: true, set: { next_title: "پیدا کردن شمارهٔ درست", next_kind: "outreach", due: TOMORROW_10 } },
        { id: "driver", label: "راننده سر بزند", sub: "شماره را حضوری بگیرد", save: true, set: { next_title: "بازدید تأیید", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "tomorrow", hour: 9 } } },
      ],
    },
    newnum: {
      id: "newnum", kind: "input", q: "شمارهٔ درست", input: { field: "new_phone", placeholder: "09__ ___ ____", ltr: true },
      options: [
        { id: "now", label: "ثبت و همین حالا تماس", tone: "rec", save: true, set: { next_title: "تماس با شمارهٔ جدید", next_kind: "call", due: { kind: "in_hours", hours: 0 }, redial: true } },
        { id: "later", label: "ثبت، فردا زنگ می‌زنم", save: true, set: { next_title: "تماس با شمارهٔ جدید", next_kind: "call", due: TOMORROW_10 } },
      ],
    },
    verify: {
      id: "verify", kind: "choice", q: "این همان «{name}» است؟", sub: "اطلاعات منبع اغلب قدیمی است؛ اول مطمئن شوید",
      options: [
        { id: "yes", label: "بله، همین است", tone: "rec", next: "who", set: { verification: "verified" } },
        { id: "renamed", label: "اسمش عوض شده", next: "rename" },
        { id: "moved", label: "جابه‌جا شده", next: "moved" },
        { id: "other", label: "کسب‌وکار دیگری است", next: "other" },
        { id: "closed", label: "تعطیل شده", tone: "bad", next: "closed" },
        { id: "notfit", label: "به کار ما نمی‌آید", next: "notfit" },
      ],
    },
    rename: {
      id: "rename", kind: "input", q: "نام تازه چیست؟", input: { field: "new_name", placeholder: "مثلاً: کبابی نایب ونک" },
      options: [{ id: "ok", label: "ادامه", next: "who", set: { verification: "renamed" } }],
    },
    moved: {
      id: "moved", kind: "choice", q: "آدرس تازه را دارید؟",
      options: [
        { id: "pin", label: "روی نقشه می‌زنم", sub: "نقشه باز می‌شود", tone: "rec", next: "movedpin", set: { verification: "moved" } },
        { id: "later", label: "بعداً، در بازدید", next: "who", set: { verification: "moved" } },
      ],
    },
    movedpin: { id: "movedpin", kind: "pin", q: "مکان تازه", options: [{ id: "ok", label: "ثبت مکان", next: "who" }] },
    other: {
      id: "other", kind: "choice", q: "این شماره مال کجاست؟ مشتری بالقوه است؟",
      options: [
        { id: "yes", label: "بله، سرنخ تازه بساز", sub: "افزودن سرنخ با همین شماره باز می‌شود", tone: "rec", save: true, set: { verification: "invalid_other_business", ...INVALID_END, spawn_lead: true } },
        { id: "no", label: "نه، ربطی ندارد", save: true, set: { verification: "wrong_number", outcome: "WRONG_NUMBER", next_title: "پیدا کردن شمارهٔ درست", next_kind: "outreach", due: TOMORROW_10 } },
      ],
    },
    closed: {
      id: "closed", kind: "choice", q: "کسب‌وکار تعطیل شده؟", sub: "از همهٔ فهرست‌ها بیرون می‌رود؛ تاریخچه می‌ماند",
      options: [{ id: "yes", label: "بله، تعطیل شده", tone: "bad", save: true, set: { verification: "invalid_closed", lost_reason: "CLOSED", ...INVALID_END } }],
    },
    notfit: {
      id: "notfit", kind: "choice", q: "چرا به کار ما نمی‌آید؟",
      options: NOT_FIT_REASONS.map((r) => ({ id: r, label: NOT_FIT_LABEL[r], save: true, set: { verification: "invalid_not_fit", not_fit: r, ...INVALID_END } })),
    },
    who: {
      id: "who", kind: "roles", q: "با چه کسی صحبت کردید؟", sub: "سمتش را بزنید؛ نام اختیاری است",
      input: { field: "contact_name", placeholder: "نام (اختیاری)…", optional: true },
      options: (ctx) => [...knownContacts(ctx), ...roleOptions("what", "gate")],
    },
    gate: {
      id: "gate", kind: "choice", q: "چه کسی خرید را انجام می‌دهد؟", sub: "{role} تصمیم‌گیرنده نیست",
      options: [
        { id: "through", label: "وصلم کرد", sub: "الان با خودش صحبت می‌کنم", tone: "rec", next: "who" },
        ...roleOptions("gatewhen", "gatewhen").filter((o) => o.group === "تصمیم‌گیرنده").map((o) => ({
          ...o, group: undefined, set: { decider_role: o.set!.contact_role, outcome: "GATEKEEPER" as const },
        })),
      ],
    },
    gatewhen: {
      id: "gatewhen", kind: "choice", q: "کی با {decider} تماس بگیریم؟", sub: "زمانی که گفتند در دسترس است", timeStep: true,
      options: timeOptions("تماس با {decider}", "call", [
        { id: "t10", label: "فردا صبح", due: TOMORROW_10, rec: true },
        { id: "today", label: "امروز عصر", due: { kind: "at_today", hour: 17 } },
        { id: "t14", label: "فردا بعد از ناهار", due: { kind: "tomorrow", hour: 15 } },
        PICK(),
      ]),
    },
    what: {
      id: "what", kind: "choice", q: "نتیجهٔ صحبت چه بود؟",
      options: [
        { id: "price", label: "قیمت خواست", sub: "داغ", next: "prods", set: { outcome: "ASKED_PRICE" } },
        { id: "sample", label: "نمونه خواست", sub: "داغ", next: "sampleprod", set: { outcome: "REQUESTED_SAMPLE" } },
        { id: "interested", label: "علاقه‌مند شد", sub: "گرم", next: "prods", set: { outcome: "INTERESTED" } },
        { id: "neg", label: "مذاکره / آمادهٔ سفارش", sub: "داغ", next: "neg", set: { outcome: "NEGOTIATING" } },
        { id: "obj", label: "ایراد گرفت", next: "obj" },
        { id: "later", label: "بعداً زنگ بزن", next: "later", set: { outcome: "CALL_BACK" } },
        { id: "no", label: "علاقه ندارد", sub: "سرد", tone: "bad", next: "why", set: { outcome: "NOT_INTERESTED" } },
      ],
    },
    prods: {
      id: "prods", kind: "multi", q: "کدام کالاها؟", sub: "چند تا را بزنید · اختیاری",
      choices: (ctx) => ctx.products.map((p) => ({ id: String(p.id), label: p.name })),
      options: [{ id: "ok", label: "ادامه", next: (_c, s) => (s.acc.outcome === "ASKED_PRICE" ? "sendnow" : "tinterest") }],
    },
    sendnow: {
      id: "sendnow", kind: "choice", q: "همین حالا قیمت بفرستم؟", sub: "از قیمت‌های امروز ساخته می‌شود",
      options: [
        { id: "wa", label: "ارسال در واتس‌اپ", sub: "پیشنهادی", tone: "rec", save: true, set: { share: "whatsapp", next_title: "پیگیری قیمت", next_kind: "quote_followup", due: { kind: "in_days", days: 3, hour: 10 } } },
        { id: "tg", label: "ارسال در تلگرام", save: true, set: { share: "telegram", next_title: "پیگیری قیمت", next_kind: "quote_followup", due: { kind: "in_days", days: 3, hour: 10 } } },
        { id: "later", label: "بعداً می‌فرستم", save: true, set: { next_title: "ارسال قیمت", next_kind: "outreach", due: { kind: "at_today", hour: 16 } } },
      ],
    },
    tinterest: {
      id: "tinterest", kind: "choice", q: "کی لیست قیمت بفرستیم؟", timeStep: true,
      options: timeOptions("ارسال لیست قیمت", "outreach", [
        { id: "t10", label: "فردا ۱۰:۰۰", due: TOMORROW_10, rec: true },
        { id: "today", label: "همین امروز", due: { kind: "at_today", hour: 16 } },
        { id: "d2", label: "۲ روز دیگر", due: { kind: "in_days", days: 2, hour: 10 } },
        PICK(),
      ]),
    },
    sampleprod: {
      id: "sampleprod", kind: "choice", q: "نمونهٔ کدام کالا؟",
      options: (ctx) => [
        ...ctx.products.slice(0, 7).map((p, i) => ({ id: `p${p.id}`, label: p.name, tone: i === 0 ? ("rec" as const) : undefined, next: "sampleqty", set: { product_id: p.id } })),
        { id: "other", label: "کالای دیگر", next: "sampleqty" },
      ],
    },
    sampleqty: {
      id: "sampleqty", kind: "choice", q: "چه مقدار؟",
      options: ["۱ بسته", "۲ بسته", "۵ عدد", "۱ کارتن"].map((q, i) => ({ id: `q${i}`, label: q, tone: i === 0 ? ("rec" as const) : undefined, next: "samplewhen", set: { sample_qty: q } })),
    },
    samplewhen: {
      id: "samplewhen", kind: "choice", q: "کی نمونه را تحویل بدهیم؟", timeStep: true,
      options: timeOptions("تحویل نمونه", "sample_delivery", [
        { id: "t10", label: "فردا", due: TOMORROW_10, rec: true },
        { id: "today", label: "امروز", due: { kind: "at_today", hour: 17 } },
        { id: "d2", label: "پس‌فردا", due: { kind: "in_days", days: 2, hour: 10 } },
        PICK(),
      ]),
    },
    neg: {
      id: "neg", kind: "choice", q: "قدم بعدی؟",
      options: [
        { id: "order", label: "ثبت سفارش همین حالا", sub: "صفحهٔ سفارش باز می‌شود", tone: "rec", save: true, set: { next_title: "ثبت سفارش", next_kind: "order", due: { kind: "in_hours", hours: 0 }, open_order: true } },
        { id: "follow", label: "پیگیری ۲ روز دیگر", save: true, set: { next_title: "پیگیری مذاکره", next_kind: "call", due: { kind: "in_days", days: 2, hour: 10 } } },
      ],
    },
    obj: {
      id: "obj", kind: "choice", q: "ایراد دربارهٔ چه بود؟",
      options: [
        { id: "price", label: "قیمت", next: "objwhen", set: { outcome: "PRICE_OBJECTION" } },
        { id: "pay", label: "شرایط پرداخت", next: "objwhen", set: { outcome: "PAYMENT_TERMS" } },
        { id: "quality", label: "کیفیت", next: "objwhen", set: { outcome: "QUALITY_DOUBT" } },
        { id: "supplier", label: "تأمین‌کننده دارد", next: "objwhen", set: { outcome: "ALREADY_SUPPLIED" } },
      ],
    },
    objwhen: {
      id: "objwhen", kind: "choice", q: "کی دوباره تماس بگیریم؟", timeStep: true,
      options: timeOptions(AGAIN, "call", [
        { id: "d3", label: "۳ روز دیگر", due: { kind: "in_days", days: 3, hour: 10 }, rec: true },
        { id: "t10", label: "فردا", due: TOMORROW_10 },
        { id: "d7", label: "هفتهٔ بعد", due: { kind: "in_days", days: 7, hour: 10 } },
        PICK(),
      ]),
    },
    later: {
      id: "later", kind: "choice", q: "کی زنگ بزنیم؟", sub: "زمانی که خودش گفت", timeStep: true,
      options: timeOptions(AGAIN, "call", [
        { id: "t10", label: "فردا ۱۰:۰۰", due: TOMORROW_10, rec: true },
        { id: "today", label: "امروز عصر", due: { kind: "at_today", hour: 17 } },
        { id: "d7", label: "هفتهٔ بعد", due: { kind: "in_days", days: 7, hour: 10 } },
        PICK("روز و ساعت…"),
      ]),
    },
    why: {
      id: "why", kind: "choice", q: "چرا علاقه ندارد؟",
      options: [
        ...WHY.map((r) => ({ id: r, label: LOST_REASON_LABEL[r], next: "wb", set: { lost_reason: r } })),
        { id: "CLOSED", label: LOST_REASON_LABEL.CLOSED, tone: "bad" as const, next: "closed" },
      ],
    },
    wb: {
      id: "wb", kind: "choice", q: "کی دوباره امتحان کنیم؟", sub: "سرنخ حذف نمی‌شود؛ سر وقتش برمی‌گردد",
      options: [
        ...timeOptions("تماس دوباره (بازگشت)", "call", [
          { id: "m3", label: "۳ ماه دیگر", due: { kind: "in_months", months: 3, hour: 10 }, rec: true },
          { id: "d30", label: "۳۰ روز دیگر", due: { kind: "in_days", days: 30, hour: 10 } },
          { id: "m6", label: "۶ ماه دیگر", due: { kind: "in_months", months: 6, hour: 10 } },
          { id: "m12", label: "۱۲ ماه دیگر", due: { kind: "in_months", months: 12, hour: 10 } },
        ]),
        { id: "reassign", label: "بده به فروشندهٔ دیگر", save: true, set: { next_title: "واگذاری «{name}» به فروشندهٔ دیگر", next_kind: "outreach", next_assignee: "group_manager", due: TOMORROW_10 } },
        { id: "contact", label: "با فرد دیگری صحبت کنم", save: true, set: { next_title: "پیدا کردن فرد دیگر", next_kind: "outreach", due: { kind: "in_days", days: 7, hour: 10 } } },
      ],
    },
    skip: SKIP_STEP,
  },
};
```

`lib/crm/flows/addLead.ts`

```ts
import { isWorkingHours, type WorkingHours } from "../hours";
import { normPhone } from "../phone";
import {
  BUSINESS_TYPES, BUSINESS_TYPE_LABEL, FOOD_APP_SOURCES, LEAD_SOURCES, LEAD_SOURCE_LABEL, PRICE_TIER_LABEL, SOURCE_KIND, faDigits,
} from "../vocab";
import { SKIP_STEP, TOMORROW_10 } from "./common";
import type { FlowConfig, FlowContext, FlowOption, FlowSet } from "./types";

export interface BasicsValue { name: string; phone: string | null; branch_of: number | null }
export interface PinValue { lat: number; lng: number; precision: "exact" | "approx"; address?: string | null }
export interface LinkValue { name: string | null; lat: number | null; lng: number | null; address: string | null; maps_url: string }

const parse = <T>(s: string | undefined): T | null => {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};
/** Inside Iran's bounding box -- also rejects the 0,0 a failed geolocation returns. */
const inIran = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && lat > 24 && lat < 40 && lng > 44 && lng < 64;

export function basicsOf(values: Record<string, string>): BasicsValue | null {
  const b = parse<BasicsValue>(values.basics);
  return b && typeof b.name === "string" ? { name: b.name, phone: b.phone ?? null, branch_of: b.branch_of ?? null } : null;
}
export function linkOf(values: Record<string, string>): LinkValue | null {
  const l = parse<LinkValue>(values.link);
  return l && typeof l.maps_url === "string" ? l : null;
}
/** The pin, most deliberate first: dropped on the map, then "I'm here", then the link's. */
export function pinOf(values: Record<string, string>): PinValue | null {
  for (const key of ["pin", "here"]) {
    const p = parse<PinValue>(values[key]);
    if (p && inIran(p.lat, p.lng)) return { lat: p.lat, lng: p.lng, precision: p.precision === "approx" ? "approx" : "exact", address: p.address ?? null };
  }
  const l = linkOf(values);
  if (l && inIran(l.lat, l.lng)) return { lat: l.lat as number, lng: l.lng as number, precision: "exact", address: l.address };
  return null;
}
export function hoursOf(values: Record<string, string>): WorkingHours {
  const h = parse<unknown>(values.hours);
  return isWorkingHours(h) ? h : [];
}
export const hasPhone = (values: Record<string, string>): boolean => !!normPhone(basicsOf(values)?.phone);

const afterHours = (ctx: FlowContext) => (ctx.isManager ? "assign" : "first");
const talkedNow: FlowOption = { id: "talked", label: "الان صحبت کردم", sub: "ثبت نتیجه", save: true, set: { handoff: "talked_now", verification: "verified", due: { kind: "none" } } };
const visitSet = (title: string): FlowSet => ({ next_title: title, next_kind: "visit", due: { kind: "tomorrow", hour: 11 } });

export const addLeadFlow: FlowConfig = {
  id: "add_lead",
  start: () => "src",
  skipStep: "skip",
  budget: { common: 7, longest: 12 },
  steps: {
    src: {
      id: "src", kind: "choice", q: "از کجا پیدایش کردید؟", sub: "منبع روی پرونده می‌ماند و در گزارش منبع‌ها شمرده می‌شود",
      options: LEAD_SOURCES.map((s) => ({ id: s, label: LEAD_SOURCE_LABEL[s], sub: s === "FIELD_VISIT" ? "اینجا هستم" : undefined, next: SOURCE_KIND[s], set: { source: s } })),
    },
    link: {
      id: "link", kind: "link", q: "لینک را بچسبانید", sub: "نام و مکان از روی لینک پر می‌شود",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "basics" }, { id: "nolink", label: "لینک ندارم", next: "basics" }],
    },
    here: {
      id: "here", kind: "pin", q: "الان جلوی همین کسب‌وکار هستید؟", sub: "مکان گوشی شما پین می‌شود؛ بعد می‌توانید جابه‌جایش کنید",
      options: [{ id: "ok", label: "همین‌جاست", tone: "rec", next: "basics", set: { verification: "verified" } }, { id: "nothere", label: "نه، بعداً روی نقشه", next: "basics" }],
    },
    ref: {
      id: "ref", kind: "choice", q: "چه کسی معرفی کرد؟",
      options: (ctx) => [
        ...ctx.recentCustomers.slice(0, 6).map((c) => ({ id: `r${c.id}`, label: c.name, next: "basics", set: { referred_by: c.id } })),
        { id: "outside", label: "نام معرف را می‌نویسم", next: "refname" },
      ],
    },
    refname: { id: "refname", kind: "input", q: "نام معرف", input: { field: "source_detail", placeholder: "نام معرف…" }, options: [{ id: "ok", label: "ادامه", next: "basics" }] },
    other: { id: "other", kind: "input", q: "منبع چیست؟", input: { field: "source_detail", placeholder: "مثلاً: نمایشگاه صنایع غذایی" }, options: [{ id: "ok", label: "ادامه", next: "basics" }] },
    basics: {
      id: "basics", kind: "basics", q: "نام و تلفن",
      sub: (_c, s) => (s.acc.source && FOOD_APP_SOURCES.has(s.acc.source) ? "اگر تلفن ندارید خالی بگذارید — اول بازدید می‌شود" : "نام لازم است؛ تلفن اختیاری"),
      options: [{ id: "ok", label: "ادامه", next: (_c, s) => (pinOf(s.values) ? "type" : "loc") }],
    },
    loc: {
      id: "loc", kind: "choice", q: "کسب‌وکار کجاست؟", sub: "بدون مکان ثبت نمی‌شود — برای مسیر و محدوده لازم است",
      options: [
        { id: "gps", label: "اینجا هستم — مکان من", sub: "از GPS گوشی", tone: "rec", next: "pin", set: { pin_mode: "gps" } },
        { id: "map", label: "روی نقشه پیدا می‌کنم", sub: "جستجو و پین", next: "pin", set: { pin_mode: "map" } },
      ],
    },
    pin: {
      id: "pin", kind: "pin", q: "پین درست است؟", sub: "پین را روی درِ ورودی بگذارید؛ اگر فقط محدوده را می‌دانید «تقریبی» را بزنید",
      options: [{ id: "ok", label: "ثبت مکان", tone: "rec", next: "type" }],
    },
    type: {
      id: "type", kind: "choice", q: "چه نوع کسب‌وکاری است؟",
      options: BUSINESS_TYPES.map((t) => ({ id: t, label: BUSINESS_TYPE_LABEL[t], next: "price", set: { business_type: t } })),
    },
    price: {
      id: "price", kind: "choice", q: "سطح قیمت منو؟",
      sub: (_c, s) => (s.acc.source && FOOD_APP_SOURCES.has(s.acc.source) ? `منوی ${LEAD_SOURCE_LABEL[s.acc.source]} را ببینید` : "اگر نمی‌دانید «نمی‌دانم» را بزنید"),
      options: [
        { id: "low", label: PRICE_TIER_LABEL.low, next: "hours", set: { price_tier: "low" } },
        { id: "mid", label: PRICE_TIER_LABEL.mid, next: "hours", set: { price_tier: "mid" } },
        { id: "high", label: PRICE_TIER_LABEL.high, next: "hours", set: { price_tier: "high" } },
        { id: "unknown", label: "نمی‌دانم", next: "hours", set: { price_tier: "unknown" } },
      ],
    },
    hours: {
      id: "hours", kind: "hours", q: "ساعت کاری", sub: "چند بازه در روز هم می‌شود؛ مثلاً ۱۲ تا ۱۶ و ۱۹ تا ۲۴",
      options: [{ id: "ok", label: "ثبت ساعت‌ها", tone: "rec", next: afterHours }, { id: "skip", label: "نمی‌دانم", next: afterHours }],
    },
    assign: {
      id: "assign", kind: "choice", q: "به چه کسی بسپاریم؟", sub: "عدد = سرنخ‌های باز هر فروشنده",
      options: (ctx) => {
        const least = ctx.reps.length ? Math.min(...ctx.reps.map((r) => r.open)) : -1;
        return [
          { id: "me", label: "خودم", next: "first", set: { owner: "me" } },
          ...ctx.reps.map((r) => ({
            id: `u${r.id}`, label: r.name, sub: `${faDigits(String(r.open))} سرنخ باز${r.open === least ? " · کم‌بارتر" : ""}`,
            tone: r.open === least ? ("rec" as const) : undefined, next: "first", set: { owner: r.id },
          })),
          { id: "pool", label: "بی‌صاحب — استخر گروه", sub: "فروشنده‌های گروه برش می‌دارند", next: "first", set: { owner: "pool" } },
        ];
      },
    },
    first: {
      id: "first", kind: "choice", q: "اولین قدم با این سرنخ؟", timeStep: true,
      sub: (_c, s) => (hasPhone(s.values) ? "اولین تماس، سرنخ را تأیید می‌کند" : "تلفن ندارد — اول بازدید می‌شود"),
      options: (_c, s) =>
        hasPhone(s.values)
          ? [
              { id: "call_today", label: "تماس اول · امروز", sub: "پیشنهادی", tone: "rec", save: true, set: { next_title: "تماس اول", next_kind: "call", due: { kind: "in_hours", hours: 1 } } },
              { id: "call_t10", label: "تماس اول · فردا ۱۰:۰۰", save: true, set: { next_title: "تماس اول", next_kind: "call", due: TOMORROW_10 } },
              { id: "visit", label: "بازدید در مسیر بعدی", save: true, set: visitSet("بازدید") },
              talkedNow,
            ]
          : [
              { id: "driver", label: "بازدید راننده در مسیر", sub: "پیشنهادی", tone: "rec", save: true, set: { next_title: "بازدید تأیید", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "tomorrow", hour: 9 } } },
              { id: "self", label: "خودم سر می‌زنم", save: true, set: visitSet("بازدید برای تأیید") },
              talkedNow,
            ],
    },
    skip: SKIP_STEP,
  },
};
```

`lib/crm/flows/driverVisit.ts`

```ts
import { roleOptions, TOMORROW_10 } from "./common";
import type { FlowConfig } from "./types";

const backToRep = { next_title: "تماس اول پس از بازدید", next_kind: "call", next_assignee: "owner", due: TOMORROW_10 } as const;

/** What a driver answers at the door of a phone-less lead. The driver's GPS at save time
 *  fixes the exact pin (sent beside the answers, not as one). */
export const driverVisitFlow: FlowConfig = {
  id: "driver_visit",
  start: () => "found",
  budget: { common: 5, longest: 5 },
  steps: {
    found: {
      id: "found", kind: "choice", q: "«{name}» را پیدا کردید؟", sub: "{address}",
      options: [
        { id: "yes", label: "بله، پیدا کردم", tone: "rec", next: "open" },
        { id: "no", label: "پیدا نشد", tone: "bad", next: "notfound" },
      ],
    },
    notfound: {
      id: "notfound", kind: "choice", q: "چه شد؟",
      options: [
        { id: "closed", label: "تعطیل شده بود", tone: "bad", save: true, set: { verification: "invalid_closed", outcome: "INVALID", invalid: true, lost_reason: "CLOSED", due: { kind: "none" } } },
        { id: "gone", label: "این‌جا چنین جایی نیست", save: true, set: { verification: "invalid_not_found", outcome: "INVALID", invalid: true, due: { kind: "none" } } },
        { id: "wrongpin", label: "آدرس اشتباه بود", save: true, set: { outcome: "VISIT_CLOSED", next_title: "پیدا کردن آدرس درست", next_kind: "outreach", next_assignee: "owner", due: TOMORROW_10 } },
      ],
    },
    open: {
      id: "open", kind: "choice", q: "باز بود؟",
      options: [
        { id: "yes", label: "بله", tone: "rec", next: "phone", set: { verification: "verified" } },
        { id: "shut", label: "بسته بود", sub: "بعداً دوباره سر می‌زنیم", save: true, set: { verification: "verified", outcome: "VISIT_CLOSED", next_title: "بازدید دوباره", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "in_days", days: 2, hour: 12 } } },
      ],
    },
    phone: {
      id: "phone", kind: "input", q: "شمارهٔ تماس گرفتید؟", sub: "بهتر است شمارهٔ مسئول خرید باشد",
      input: { field: "new_phone", placeholder: "09__ ___ ____", ltr: true, optional: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "who" }],
    },
    who: {
      id: "who", kind: "roles", q: "با چه کسی صحبت کردید؟", input: { field: "contact_name", placeholder: "نام (اختیاری)…", optional: true },
      options: roleOptions("interest", "interest"),
    },
    interest: {
      id: "interest", kind: "choice", q: "علاقه نشان دادند؟",
      options: [
        { id: "yes", label: "بله، گفتند زنگ بزنید", tone: "rec", save: true, set: { outcome: "INTERESTED", ...backToRep } },
        { id: "neutral", label: "نه خیلی، نه کم", save: true, set: { outcome: "TALKED", ...backToRep } },
        { id: "no", label: "علاقه نداشتند", save: true, set: { outcome: "NOT_INTERESTED", ...backToRep } },
      ],
    },
  },
};
```

- [ ] **Step 4:** `npx vitest run tests/crm-flow-configs.test.ts` → PASS. If a budget assertion fails, print `checkFlow(...)` and shorten the offending branch; do not raise the budget.
- [ ] **Step 5:** `git add lib/crm/flows tests/crm-flow-configs.test.ts && git commit -m "feat(crm): after-call, add-lead and driver-visit flows"`

---

## Task 7: Schema, migration and backfill

**Files:**
- Create: `lib/repo/crm/migrate.ts`
- Modify: `lib/db.ts` — import; `TENANT_TABLES` (+ `"contacts"`, `"activities"`); call `createCrmTables(db)` immediately above the comment `// ALTER each table now, up front, and backfill immediately` (the first `for (const table of TENANT_TABLES)` loop, ~line 2385 — it ALTERs every listed table, so they must exist first); call `migrateCrm(db)` on the line after `backfillReminderTasks(db);` (~line 3103).
- Test: `tests/crm-schema.test.ts`, `tests/crm-migration-realdata.test.ts`

**Interfaces:**
- Consumes: `normPhone` (T1), `replayCrmState`, `ActivityFacts` (T4).
- Produces: tables `contacts`, `activities` (+ triggers); the customers columns of spec §1.1 + §8; `createCrmTables(db)`, `migrateCrm(db)`, `backfillCrm(db)`, `initialFacts(lifecycle, deliveredOrders, at)`, `ACTIVITY_FACT_COLUMNS`.

- [ ] **Step 1: Write the failing tests**

`tests/crm-schema.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { backfillCrm, initialFacts } = await import("@/lib/repo/crm/migrate");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = (t: string) => (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const NOW = "2026-09-01T00:00:00.000Z";

describe("CRM schema", () => {
  it("creates contacts and activities as tenant tables", () => {
    expect((TENANT_TABLES as readonly string[]).includes("contacts")).toBe(true);
    expect((TENANT_TABLES as readonly string[]).includes("activities")).toBe(true);
    expect(cols("contacts")).toEqual(expect.arrayContaining(["customer_id", "role", "phone_norm", "is_primary", "is_decider"]));
    expect(cols("activities")).toEqual(expect.arrayContaining(["contact_status_to", "stage_to", "verification_to", "signal", "attempt", "miss", "talked", "answers_json"]));
  });
  it("adds the business columns to customers", () => {
    expect(cols("customers")).toEqual(expect.arrayContaining([
      "owner_user_id", "business_type", "phone_norm", "price_tier", "working_hours_json", "location_precision",
      "district_id", "area_label", "source_code", "verification", "contact_status", "sales_stage", "temperature",
      "temperature_manual", "attempt_count", "consecutive_misses", "last_activity_at", "last_contacted_at",
      "next_task_id", "lost_reason_code", "merged_into_id", "closed_at",
    ]));
  });
  it("keeps activities append-only", () => {
    const db = getDb();
    const cid = Number(db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('AO-1','الف',?,1)").run(NOW).lastInsertRowid);
    const aid = Number(db.prepare("INSERT INTO activities (organization_id, customer_id, type, occurred_at, created_at) VALUES (1,?,'note',?,?)").run(cid, NOW, NOW).lastInsertRowid);
    expect(() => db.prepare("UPDATE activities SET note = 'x' WHERE id = ?").run(aid)).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM activities WHERE id = ?").run(aid)).toThrow(/append-only/);
  });
});

describe("backfillCrm", () => {
  it("maps lifecycle to the initial facts", () => {
    expect(initialFacts("lead", 0, NOW)).toMatchObject({ verification_to: "unverified", stage_to: null, talked: 0 });
    expect(initialFacts("qualified", 0, NOW)).toMatchObject({ stage_to: "interested", signal: "warm", contact_status_to: "contacted" });
    expect(initialFacts("active", 2, NOW).stage_to).toBe("repeat_customer");
    expect(initialFacts("active", 1, NOW).stage_to).toBe("first_order");
    expect(initialFacts("dormant", 0, NOW).stage_to).toBe("customer");
  });
  it("backfills owner, primary contact, phone_norm and state = replay", () => {
    const db = getDb();
    const uid = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('bf1','x','فاطمه','salesperson',?,1)").run(NOW).lastInsertRowid);
    const lead = Number(db.prepare("INSERT INTO customers (customer_code,business_name,contact_person,phone,synced_at,organization_id,lifecycle) VALUES ('BF-1','سرنخ','علی','0912 000 1234',?,1,'lead')").run(NOW).lastInsertRowid);
    const qual = Number(db.prepare("INSERT INTO customers (customer_code,business_name,salesperson,synced_at,organization_id,lifecycle) VALUES ('BF-2','پیگیری','فاطمه',?,1,'qualified')").run(NOW).lastInsertRowid);
    db.prepare("DELETE FROM app_meta WHERE key = 'crm_backfill_v1'").run();
    backfillCrm(db);

    const l = db.prepare("SELECT * FROM customers WHERE id = ?").get(lead) as Record<string, unknown>;
    expect(l).toMatchObject({ phone_norm: "9120001234", verification: "unverified", contact_status: "not_contacted", sales_stage: "unknown", temperature: "cold" });
    expect(db.prepare("SELECT name, is_primary FROM contacts WHERE customer_id = ?").get(lead)).toEqual({ name: "علی", is_primary: 1 });

    const q = db.prepare("SELECT * FROM customers WHERE id = ?").get(qual) as Record<string, unknown>;
    expect(q).toMatchObject({ owner_user_id: uid, verification: "verified", contact_status: "contacted", sales_stage: "interested", temperature: "warm", last_contacted_at: NOW });
    expect((db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'system'").get(qual) as { n: number }).n).toBe(1);

    // idempotent: a second run is a no-op
    backfillCrm(db);
    expect((db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ?").get(qual) as { n: number }).n).toBe(1);
  });
});
```

`tests/crm-migration-realdata.test.ts` (skips when no backup exists)

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const provided = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
let dbPath = provided ?? "";
if (!provided) {
  const dir = path.join(process.cwd(), "data", "backups");
  try {
    const newest = fs.readdirSync(dir).filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    if (newest) {
      dbPath = path.join(os.tmpdir(), `rf-crm-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
    }
  } catch { /* none */ }
}

// Snapshot before the migration runs.
let before: { customers: number; lifecycles: string } | null = null;
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  before = {
    customers: (raw.prepare("SELECT COUNT(*) n FROM customers").get() as { n: number }).n,
    lifecycles: JSON.stringify(raw.prepare("SELECT lifecycle, COUNT(*) n FROM customers GROUP BY 1 ORDER BY 1").all()),
  };
  raw.close();
}

process.env.ROUTEFLOW_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-crm-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { replayCrmState } = await import("@/lib/crm/replay");
const { ACTIVITY_FACT_COLUMNS } = await import("@/lib/repo/crm/migrate");

describe.skipIf(!dbPath)("CRM migration on real data", () => {
  it("is lossless and leaves every business's state equal to its replay", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) n FROM customers").get() as { n: number }).n).toBe(before!.customers);
    expect(JSON.stringify(db.prepare("SELECT lifecycle, COUNT(*) n FROM customers GROUP BY 1 ORDER BY 1").all())).toBe(before!.lifecycles);

    const rows = db.prepare("SELECT id, contact_status, sales_stage, verification, temperature, attempt_count FROM customers").all() as Record<string, unknown>[];
    for (const r of rows) {
      const acts = db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(r.id as number) as never[];
      expect(acts.length, `customer ${r.id}`).toBeGreaterThan(0);
      const s = replayCrmState(acts);
      expect({ contact_status: r.contact_status, sales_stage: r.sales_stage, verification: r.verification, temperature: r.temperature, attempt_count: r.attempt_count })
        .toEqual({ contact_status: s.contact_status, sales_stage: s.sales_stage, verification: s.verification, temperature: s.temperature, attempt_count: s.attempt_count });
    }
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-schema.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/repo/crm/migrate.ts`

```ts
import type { DatabaseSync } from "node:sqlite";
import { normPhone } from "@/lib/crm/phone";
import { replayCrmState, type ActivityFacts } from "@/lib/crm/replay";
import type { SalesStage, Temperature } from "@/lib/crm/vocab";

/** The activity columns the replay folds, as a SELECT list. */
export const ACTIVITY_FACT_COLUMNS =
  "occurred_at, contact_status_to, stage_to, verification_to, signal, attempt, miss, talked";

/** Called from getDb() before the TENANT_TABLES loop, which ALTERs every listed table. */
export function createCrmTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      name TEXT,
      role TEXT NOT NULL DEFAULT 'OTHER',
      phone TEXT,
      phone_norm TEXT,
      whatsapp TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      is_decider INTEGER NOT NULL DEFAULT 0,
      best_time TEXT,
      note TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_contacts_customer ON contacts(customer_id);
    CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts(organization_id, phone_norm);

    /* Append-only: a correction is a new row pointing at the one it corrects. The replay
       folds the *_to / signal / flag columns, never the outcome code. */
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      user_id INTEGER REFERENCES users(id),
      contact_id INTEGER REFERENCES contacts(id),
      type TEXT NOT NULL,
      outcome_code TEXT,
      attempt_no INTEGER,
      phone_used TEXT,
      note TEXT,
      answers_json TEXT,
      contact_status_to TEXT,
      stage_to TEXT,
      verification_to TEXT,
      signal TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      miss INTEGER NOT NULL DEFAULT 0,
      talked INTEGER NOT NULL DEFAULT 0,
      completed_task_id INTEGER,
      next_task_id INTEGER,
      corrects_activity_id INTEGER REFERENCES activities(id),
      client_uuid TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_activities_customer ON activities(customer_id, occurred_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_activities_client_uuid ON activities(organization_id, client_uuid) WHERE client_uuid IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS activities_no_update BEFORE UPDATE ON activities
      BEGIN SELECT RAISE(ABORT, 'activities is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activities_no_delete BEFORE DELETE ON activities
      BEGIN SELECT RAISE(ABORT, 'activities is append-only'); END;
  `);
}

const CUSTOMER_COLUMNS: [string, string][] = [
  ["owner_user_id", "INTEGER REFERENCES users(id)"], ["business_type", "TEXT"], ["secondary_phone", "TEXT"],
  ["whatsapp", "TEXT"], ["instagram", "TEXT"], ["website", "TEXT"], ["phone_norm", "TEXT"], ["size_band", "TEXT"],
  ["price_tier", "TEXT"], ["working_hours_json", "TEXT"], ["location_precision", "TEXT"], ["maps_url", "TEXT"],
  ["rating_potential", "INTEGER"], ["rating_volume", "INTEGER"], ["rating_ease", "INTEGER"], ["district_id", "INTEGER"],
  ["area_label", "TEXT"], ["source_code", "TEXT"], ["source_detail", "TEXT"], ["source_url", "TEXT"],
  ["referred_by_customer_id", "INTEGER"], ["verification", "TEXT"], ["contact_status", "TEXT"], ["sales_stage", "TEXT"],
  ["temperature", "TEXT"], ["temperature_manual", "INTEGER NOT NULL DEFAULT 0"], ["attempt_count", "INTEGER NOT NULL DEFAULT 0"],
  ["consecutive_misses", "INTEGER NOT NULL DEFAULT 0"], ["last_activity_at", "TEXT"], ["last_contacted_at", "TEXT"],
  ["next_task_id", "INTEGER"], ["lost_reason_code", "TEXT"], ["merged_into_id", "INTEGER"], ["closed_at", "TEXT"],
];

/** Called from getDb() after backfillReminderTasks, when every customers column it reads exists. */
export function migrateCrm(db: DatabaseSync): void {
  const have = new Set((db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name));
  for (const [col, type] of CUSTOMER_COLUMNS) if (!have.has(col)) db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${type}`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS ix_customers_phone_norm ON customers(organization_id, phone_norm);
    CREATE INDEX IF NOT EXISTS ix_customers_owner ON customers(organization_id, owner_user_id);
    CREATE INDEX IF NOT EXISTS ix_customers_next_task ON customers(next_task_id);
  `);
  backfillCrm(db);
}

export function initialFacts(lifecycle: string, deliveredOrders: number, at: string): ActivityFacts {
  const lead = lifecycle === "lead";
  let stage: SalesStage;
  if (lead) stage = "unknown";
  else if (lifecycle === "qualified") stage = "interested";
  else if (lifecycle === "sampled") stage = "sample";
  else if (lifecycle === "lost") stage = "lost";
  else stage = deliveredOrders >= 2 ? "repeat_customer" : deliveredOrders === 1 ? "first_order" : "customer";
  const signal: Temperature | null = lifecycle === "qualified" ? "warm" : lifecycle === "sampled" ? "hot" : null;
  return {
    occurred_at: at,
    contact_status_to: lead ? null : "contacted",
    stage_to: stage === "unknown" ? null : stage,
    verification_to: lead ? "unverified" : "verified",
    signal,
    attempt: 0,
    miss: 0,
    talked: lead ? 0 : 1,
  };
}

/** One-time: owner from the free-text salesperson, a primary contact from contact_person /
 *  phone, one 'system' activity carrying each business's starting facts, and the cached
 *  state columns written from the replay of that activity. Guarded on app_meta. */
export function backfillCrm(db: DatabaseSync): void {
  if (db.prepare("SELECT value FROM app_meta WHERE key = 'crm_backfill_v1'").get()) return;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      UPDATE customers SET owner_user_id = (
        SELECT u.id FROM users u
         WHERE u.organization_id = customers.organization_id AND u.display_name = customers.salesperson
           AND u.role IN ('salesperson', 'group_manager', 'rep_manager', 'owner') AND u.active = 1
         ORDER BY u.id LIMIT 1)
      WHERE owner_user_id IS NULL AND salesperson IS NOT NULL AND TRIM(salesperson) <> ''`);

    const delivered = new Map<number, number>(
      (db.prepare(`SELECT customer_id, COUNT(*) n FROM orders
                    WHERE status IN ('DELIVERED', 'CLOSED') AND COALESCE(order_type, 'SALE') = 'SALE'
                    GROUP BY customer_id`).all() as { customer_id: number; n: number }[]).map((r) => [r.customer_id, r.n])
    );
    const customers = db.prepare("SELECT id, organization_id, phone, contact_person, lifecycle, synced_at FROM customers").all() as {
      id: number; organization_id: number; phone: string | null; contact_person: string | null; lifecycle: string; synced_at: string;
    }[];
    const insContact = db.prepare(`INSERT INTO contacts (organization_id, customer_id, name, role, phone, phone_norm, is_primary, is_decider, created_at, updated_at)
                                   VALUES (?, ?, ?, 'OTHER', ?, ?, 1, 0, ?, ?)`);
    const insAct = db.prepare(`INSERT INTO activities (organization_id, customer_id, type, note, contact_status_to, stage_to, verification_to, signal, attempt, miss, talked, occurred_at, created_at)
                               VALUES (?, ?, 'system', 'وضعیت اولیه از داده‌های پیشین', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const openTask = db.prepare(`SELECT id FROM tasks WHERE entity_type = 'customer' AND entity_id = ? AND status = 'open'
                                 ORDER BY COALESCE(due_at, '9999'), id LIMIT 1`);
    const upd = db.prepare(`UPDATE customers SET phone_norm = ?, contact_status = ?, sales_stage = ?, verification = ?, temperature = ?,
                              attempt_count = ?, consecutive_misses = ?, last_activity_at = ?, last_contacted_at = ?, next_task_id = ?
                            WHERE id = ?`);
    for (const c of customers) {
      const norm = normPhone(c.phone);
      const name = c.contact_person?.trim() || null;
      if (name || norm) insContact.run(c.organization_id, c.id, name, c.phone, norm, now, now);
      const f = initialFacts(c.lifecycle, delivered.get(c.id) ?? 0, c.synced_at);
      insAct.run(c.organization_id, c.id, f.contact_status_to, f.stage_to, f.verification_to, f.signal, f.attempt, f.miss, f.talked, f.occurred_at, now);
      const s = replayCrmState([f]);
      const task = openTask.get(c.id) as { id: number } | undefined;
      upd.run(norm, s.contact_status, s.sales_stage, s.verification, s.temperature, s.attempt_count, s.consecutive_misses,
        s.last_activity_at, s.last_contacted_at, task?.id ?? null, c.id);
    }
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('crm_backfill_v1', ?)").run(now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
```

Then in `lib/db.ts`:

```ts
// top, with the other imports
import { createCrmTables, migrateCrm } from "@/lib/repo/crm/migrate";
```

```ts
// TENANT_TABLES: append after "notifications",
  "contacts",
  "activities",
```

```ts
  // CRM (docs/superpowers/specs/2026-09-11-crm-leads-customers-design.md): created before the
  // TENANT_TABLES loop below, which ALTERs every table it lists.
  createCrmTables(db);

  // ALTER each table now, up front, and backfill immediately -- ...   (existing comment)
```

```ts
  backfillReminderTasks(db);
  migrateCrm(db);
```

If `users.active` does not exist on an old DB at that point the owner backfill fails — it exists (added before `backfillReminderTasks`); verify with `grep -n "ADD COLUMN active" lib/db.ts` before running.

- [ ] **Step 4: Run** — `npx vitest run tests/crm-schema.test.ts tests/crm-migration-realdata.test.ts tests/tenancy-isolation.test.ts tests/tenancy-schema.test.ts tests/repo-boundary.test.ts` → PASS. Then the whole suite: `npx vitest run` → same pass count as the Task 0 baseline plus the new tests. If a suite that `DELETE`s from `customers` now fails on the activities FK, that test created CRM activities — give it fresh customers instead of deleting.
- [ ] **Step 5:** `git add lib/repo/crm/migrate.ts lib/db.ts tests/crm-schema.test.ts tests/crm-migration-realdata.test.ts && git commit -m "feat(crm): contacts + append-only activities, business columns, lossless backfill"`

---

## Task 8: Backend scoping

**Files:**
- Modify: `lib/session.ts` (append after `orderFilter`)
- Test: `tests/crm-scope.test.ts`

**Interfaces:**
- Consumes: `Session` (lib/session.ts), `canReachUser` (existing).
- Produces: `isCrmManager(role)`, `crmFilter(session, alias = "c")`, `BusinessScopeRow`, `canSeeBusiness(session, row)`, `canWriteBusiness(session, row)`.

- [ ] **Step 1: Write the failing test** — `tests/crm-scope.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { crmFilter, canSeeBusiness, canWriteBusiness } = await import("@/lib/session");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-01T00:00:00.000Z";
const db = getDb();
db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'دیگر', 'other', ?)").run(NOW);
const g1 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW).lastInsertRowid);
const g2 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g2','g2',?,1)").run(NOW).lastInsertRowid);
const user = (u: string, role: string, gid: number | null, org = 1) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,?)").run(u, "x", u, role, gid, NOW, org).lastInsertRowid);
const repA = user("repA", "salesperson", g1);
const repB = user("repB", "salesperson", g1);
const mgr1 = user("mgr1", "group_manager", g1);
const cust = (code: string, owner: number | null, gid: number | null, org = 1) =>
  Number(db.prepare("INSERT INTO customers (customer_code,business_name,owner_user_id,group_id,synced_at,organization_id) VALUES (?,?,?,?,?,?)").run(code, code, owner, gid, NOW, org).lastInsertRowid);
const mineA = cust("A1", repA, g1);
const mineB = cust("B1", repB, g1);
const pool1 = cust("P1", null, g1);
const pool2 = cust("P2", null, g2);
const other = cust("O1", null, null, 2);

const sess = (id: number, role: Session["role"], groupId: number | null, organizationId = 1): Session =>
  ({ user: { id } as Session["user"], role, groupId, organizationId });
const visible = (s: Session) => {
  const f = crmFilter(s, "c");
  return (db.prepare(`SELECT id FROM customers c WHERE 1 = 1${f.sql} ORDER BY id`).all(...f.params) as { id: number }[]).map((r) => r.id);
};

describe("crmFilter", () => {
  it("salesperson: own + own group's unassigned pool", () => {
    expect(visible(sess(repA, "salesperson", g1))).toEqual([mineA, pool1]);
  });
  it("group manager and rep manager: their group", () => {
    expect(visible(sess(mgr1, "group_manager", g1))).toEqual([mineA, mineB, pool1]);
    expect(visible(sess(mgr1, "rep_manager", g1))).toEqual([mineA, mineB, pool1]);
    expect(visible(sess(mgr1, "group_manager", null))).toEqual([]);
  });
  it("owner: the whole organisation, never another", () => {
    expect(visible(sess(1, "owner", null))).toEqual([mineA, mineB, pool1, pool2]);
    expect(visible(sess(1, "owner", null, 2))).toEqual([other]);
  });
  it("driver: nothing", () => expect(visible(sess(99, "driver", g1))).toEqual([]));
});

describe("canSeeBusiness / canWriteBusiness", () => {
  const row = (owner_user_id: number | null, group_id: number | null, organization_id = 1) => ({ owner_user_id, group_id, organization_id });
  it("mirrors the filter", () => {
    expect(canSeeBusiness(sess(repA, "salesperson", g1), row(repB, g1))).toBe(false);
    expect(canSeeBusiness(sess(repA, "salesperson", g1), row(null, g1))).toBe(true);
    expect(canSeeBusiness(sess(1, "owner", null), row(null, null, 2))).toBe(false);
  });
  it("lets a salesperson write their own and claim the pool; a manager writes the group", () => {
    expect(canWriteBusiness(sess(repA, "salesperson", g1), row(repA, g1))).toBe(true);
    expect(canWriteBusiness(sess(repA, "salesperson", g1), row(null, g1))).toBe(true);
    expect(canWriteBusiness(sess(repA, "salesperson", g1), row(repB, g1))).toBe(false);
    expect(canWriteBusiness(sess(mgr1, "group_manager", g1), row(repB, g1))).toBe(true);
    expect(canWriteBusiness(sess(mgr1, "group_manager", g1), row(repB, g2))).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-scope.test.ts` → FAIL (`crmFilter` is not exported).

- [ ] **Step 3: Implement** — append to `lib/session.ts`:

```ts
/** Who runs a group's CRM: sees all of it, reassigns, pins temperature, reads team numbers. */
export function isCrmManager(role: Role): boolean {
  return role === "owner" || role === "group_manager" || role === "rep_manager" || role === "platform_owner";
}

/** CRM visibility, as a WHERE fragment on a customers alias.
 *
 *    owner            the organisation
 *    group_manager,
 *    rep_manager      their group (no group: nothing)
 *    salesperson      businesses they own, plus their group's unassigned pool
 *    driver           nothing -- drivers reach only their verification visits, through
 *                     lib/repo/crm/driverVisits.ts
 *
 *  Never an empty fragment for a scoped role: an empty fragment widens to everything. */
export function crmFilter(session: Session, alias = "c"): { sql: string; params: number[] } {
  const a = alias ? `${alias}.` : "";
  switch (session.role) {
    case "platform_owner":
      return { sql: "", params: [] };
    case "owner":
      return { sql: ` AND ${a}organization_id = ?`, params: [session.organizationId] };
    case "group_manager":
    case "rep_manager":
      if (session.groupId === null) return { sql: " AND 1 = 0", params: [] };
      return { sql: ` AND ${a}organization_id = ? AND ${a}group_id = ?`, params: [session.organizationId, session.groupId] };
    case "salesperson":
      if (session.groupId === null) {
        return { sql: ` AND ${a}organization_id = ? AND ${a}owner_user_id = ?`, params: [session.organizationId, session.user.id] };
      }
      return {
        sql: ` AND ${a}organization_id = ? AND (${a}owner_user_id = ? OR (${a}owner_user_id IS NULL AND ${a}group_id = ?))`,
        params: [session.organizationId, session.user.id, session.groupId],
      };
    default:
      return { sql: " AND 1 = 0", params: [] };
  }
}

export interface BusinessScopeRow { owner_user_id: number | null; group_id: number | null; organization_id: number }

export function canSeeBusiness(session: Session, row: BusinessScopeRow): boolean {
  if (session.role === "platform_owner") return true;
  if (row.organization_id !== session.organizationId) return false;
  if (session.role === "owner") return true;
  if (session.role === "group_manager" || session.role === "rep_manager") return session.groupId !== null && row.group_id === session.groupId;
  if (session.role === "salesperson") {
    return row.owner_user_id === session.user.id || (row.owner_user_id === null && session.groupId !== null && row.group_id === session.groupId);
  }
  return false;
}

/** Same as seeing, today: a salesperson's write on the pool auto-claims it. Kept separate so
 *  a later rule (read-only group browsing) changes one function, not every route. */
export function canWriteBusiness(session: Session, row: BusinessScopeRow): boolean {
  return canSeeBusiness(session, row);
}
```

(`Role` is already imported in `lib/session.ts`; if not, add `import type { Role } from "./roles";`.)

- [ ] **Step 4:** `npx vitest run tests/crm-scope.test.ts` → PASS.
- [ ] **Step 5:** `git add lib/session.ts tests/crm-scope.test.ts && git commit -m "feat(crm): crmFilter -- own + group pool for reps, group for managers, 404 elsewhere"`

---

## Task 9: Repo reads — list, counts, contexts, duplicates

**Files:**
- Create: `lib/repo/crm/businesses.ts`, `lib/repo/crm/dedupe.ts`
- Test: `tests/crm-businesses-repo.test.ts`

**Interfaces:**
- Consumes: `crmFilter`, `canSeeBusiness`, `isCrmManager` (T8); `FlowContext` (T5); `resolveDue` (T3); vocab; `normPhone`, `namesAlike` (T1); `distanceKm(a, b)` from `lib/geo.ts`; `normalisePersian` from `lib/persian.ts`.
- Produces: `CRM_VIEWS`, `CrmView`, `BusinessRow`, `endOfTodayIso(nowIso)`, `listBusinesses(session, { view, q?, offset?, limit?, nowIso? }) → { rows, nextOffset }`, `viewCounts(session, nowIso?) → Record<CrmView, number>`, `getBusiness(session, id) → BusinessRow | null`, `productsWithPrice(orgId)`, `flowContextFor(session, id, entry) → { business, ctx } | null`, `addLeadContext(session) → FlowContext`; `DupMatch`, `findDuplicates(session, { phone?, name?, lat?, lng? })`.

- [ ] **Step 1: Write the failing test** — `tests/crm-businesses-repo.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-biz-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { listBusinesses, viewCounts, getBusiness, flowContextFor, addLeadContext } = await import("@/lib/repo/crm/businesses");
const { findDuplicates } = await import("@/lib/repo/crm/dedupe");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z"; // 09:30 Tehran
const db = getDb();
const g1 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW).lastInsertRowid);
const user = (u: string, role: string) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, role, g1, NOW).lastInsertRowid);
const repA = user("repA", "salesperson");
const repB = user("repB", "salesperson");
const mgr = user("mgr", "group_manager");
const cust = (name: string, owner: number | null, extra: Record<string, unknown> = {}) => {
  const row = { customer_code: name, business_name: name, owner_user_id: owner, group_id: g1, synced_at: NOW, organization_id: 1,
    verification: "unverified", sales_stage: "unknown", contact_status: "not_contacted", temperature: "cold", ...extra };
  const k = Object.keys(row);
  return Number(db.prepare(`INSERT INTO customers (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(Object.values(row) as never[])).lastInsertRowid);
};
const hotLead = cust("کبابی داغ", repA, { temperature: "hot", phone: "09120001234", phone_norm: "9120001234", lat: 35.76, lng: 51.41 });
const custA = cust("مشتری الف", repA, { sales_stage: "customer", verification: "verified" });
const pool = cust("سرنخ بی‌صاحب", null);
const bLead = cust("کافه لمیز تجریش", repB, { phone_norm: "9120005678", lat: 35.8, lng: 51.43 });
const task = Number(db.prepare("INSERT INTO tasks (organization_id, kind, title, entity_type, entity_id, due_at, assignee_user_id, created_at) VALUES (1,'call','تماس اول','customer',?,?,?,?)").run(hotLead, "2026-09-11T10:00:00.000Z", repA, NOW).lastInsertRowid);
db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(task, hotLead);
db.prepare("INSERT INTO contacts (organization_id, customer_id, name, role, is_primary, created_at, updated_at) VALUES (1,?,?,?,1,?,?)").run(hotLead, "علی", "PURCHASING", NOW, NOW);

const sess = (id: number, role: Session["role"]): Session => ({ user: { id } as Session["user"], role, groupId: g1, organizationId: 1 });
const A = sess(repA, "salesperson");
const ids = (r: { rows: { id: number }[] }) => r.rows.map((x) => x.id).sort((a, b) => a - b);

describe("listBusinesses", () => {
  it("today: open next actions due by the end of today (Tehran)", () => {
    const r = listBusinesses(A, { view: "today", nowIso: NOW });
    expect(ids(r)).toEqual([hotLead]);
    expect(r.rows[0]).toMatchObject({ next_title: "تماس اول", contact_name: "علی", contact_role: "PURCHASING" });
  });
  it("views split leads, customers and the pool", () => {
    expect(ids(listBusinesses(A, { view: "my_leads", nowIso: NOW }))).toEqual([hotLead]);
    expect(ids(listBusinesses(A, { view: "my_customers", nowIso: NOW }))).toEqual([custA]);
    expect(ids(listBusinesses(A, { view: "unassigned", nowIso: NOW }))).toEqual([pool]);
    expect(ids(listBusinesses(A, { view: "hot", nowIso: NOW }))).toEqual([hotLead]);
    expect(ids(listBusinesses(A, { view: "all", nowIso: NOW }))).toEqual([hotLead, custA, pool]);
    expect(ids(listBusinesses(sess(mgr, "group_manager"), { view: "all", nowIso: NOW }))).toEqual([hotLead, custA, pool, bLead]);
  });
  it("searches name and phone", () => {
    expect(ids(listBusinesses(A, { view: "all", q: "داغ", nowIso: NOW }))).toEqual([hotLead]);
    expect(ids(listBusinesses(A, { view: "all", q: "۰۰۰۱۲", nowIso: NOW }))).toEqual([hotLead]);
  });
  it("counts every view", () => {
    expect(viewCounts(A, NOW)).toMatchObject({ today: 1, my_leads: 1, my_customers: 1, unassigned: 1, hot: 1, all: 3 });
  });
});

describe("getBusiness / contexts", () => {
  it("returns null out of scope", () => {
    expect(getBusiness(A, bLead)).toBeNull();
    expect(getBusiness(A, hotLead)?.business_name).toBe("کبابی داغ");
  });
  it("builds the after-call context", () => {
    const r = flowContextFor(A, hotLead, "call")!;
    expect(r.ctx).toMatchObject({ entry: "call", firstContact: true, attemptNo: 1, isManager: false });
    expect(r.ctx.knownContacts).toEqual([{ id: expect.any(Number), name: "علی", role: "PURCHASING" }]);
    expect(r.ctx.vars.name).toBe("کبابی داغ");
  });
  it("builds the add-lead context with reps for a manager only", () => {
    expect(addLeadContext(A).reps).toEqual([]);
    const m = addLeadContext(sess(mgr, "group_manager"));
    expect(m.isManager).toBe(true);
    expect(m.reps.map((r) => r.id).sort()).toEqual([repA, repB].sort());
  });
});

describe("findDuplicates", () => {
  it("shows a reachable phone match in full and redacts one the caller cannot see", () => {
    expect(findDuplicates(A, { phone: "0912 000 1234" })).toEqual([
      expect.objectContaining({ kind: "phone", reachable: true, id: hotLead, name: "کبابی داغ" }),
    ]);
    expect(findDuplicates(A, { phone: "09120005678" })).toEqual([
      expect.objectContaining({ kind: "phone", reachable: false, id: null, name: null, owner_name: "repB" }),
    ]);
  });
  it("warns about a similar name close by, not far away", () => {
    const near = findDuplicates(sess(mgr, "group_manager"), { name: "کافه لمیز", lat: 35.8005, lng: 51.4302 });
    expect(near).toEqual([expect.objectContaining({ kind: "name", id: bLead })]);
    expect(findDuplicates(sess(mgr, "group_manager"), { name: "کافه لمیز", lat: 35.7, lng: 51.3 })).toEqual([]);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-businesses-repo.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/repo/crm/businesses.ts`

```ts
import { getDb } from "@/lib/db";
import { canSeeBusiness, crmFilter, isCrmManager, type Session } from "@/lib/session";
import { resolveDue } from "@/lib/crm/due";
import type { FlowContext } from "@/lib/crm/flows/types";
import { normalisePersian } from "@/lib/persian";
import { CONTACT_ROLES, CONTACT_ROLE_LABEL, LEAD_SOURCE_LABEL, LEAD_SOURCES, isOneOf, type ContactRole } from "@/lib/crm/vocab";

export const CRM_VIEWS = ["today", "hot", "my_leads", "my_customers", "unassigned", "at_risk", "all"] as const;
export type CrmView = (typeof CRM_VIEWS)[number];

export interface BusinessRow {
  id: number; business_name: string; business_type: string | null; area_label: string | null; address: string | null;
  phone_norm: string | null; lat: number | null; lng: number | null; location_precision: string | null; maps_url: string | null;
  temperature: string | null; sales_stage: string | null; contact_status: string | null; verification: string | null;
  price_tier: string | null; working_hours_json: string | null; source_code: string | null;
  owner_user_id: number | null; owner_name: string | null; group_id: number | null; organization_id: number;
  attempt_count: number; last_activity_at: string | null; next_task_id: number | null;
  next_title: string | null; next_kind: string | null; next_due_at: string | null;
  contact_name: string | null; contact_role: string | null; last_order_at: string | null; closed_at: string | null;
}

const CUSTOMER_STAGES_SQL = "('first_order', 'customer', 'repeat_customer')";
const STAGE = "COALESCE(c.sales_stage, 'unknown')";
const LAST_ORDER = `(SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id
  AND o.status IN ('DELIVERED', 'CLOSED') AND COALESCE(o.order_type, 'SALE') = 'SALE')`;
const PRIMARY = (col: string) => `(SELECT k.${col} FROM contacts k WHERE k.customer_id = c.id AND k.active = 1 ORDER BY k.is_primary DESC, k.id LIMIT 1)`;

const SELECT = `
  SELECT c.id, c.business_name, c.business_type, c.area_label, c.address, c.phone_norm, c.lat, c.lng,
         c.location_precision, c.maps_url, c.temperature, c.sales_stage, c.contact_status, c.verification,
         c.price_tier, c.working_hours_json, c.source_code, c.owner_user_id, u.display_name AS owner_name,
         c.group_id, c.organization_id, COALESCE(c.attempt_count, 0) AS attempt_count, c.last_activity_at,
         c.next_task_id, t.title AS next_title, t.kind AS next_kind, t.due_at AS next_due_at,
         ${PRIMARY("name")} AS contact_name, ${PRIMARY("role")} AS contact_role,
         ${LAST_ORDER} AS last_order_at, c.closed_at
    FROM customers c
    LEFT JOIN users u ON u.id = c.owner_user_id
    LEFT JOIN tasks t ON t.id = c.next_task_id AND t.status = 'open'`;

/** The next Tehran midnight. */
export const endOfTodayIso = (nowIso: string): string => resolveDue({ kind: "tomorrow", hour: 0 }, nowIso) as string;

function viewSql(view: CrmView, session: Session, nowIso: string): { sql: string; params: (string | number)[] } {
  const open = " AND c.closed_at IS NULL";
  switch (view) {
    case "today":
      return { sql: `${open} AND t.id IS NOT NULL AND t.due_at < ?`, params: [endOfTodayIso(nowIso)] };
    case "hot":
      return { sql: `${open} AND c.temperature = 'hot' AND ${STAGE} NOT IN ${CUSTOMER_STAGES_SQL}`, params: [] };
    case "my_leads":
      return { sql: `${open} AND c.owner_user_id = ? AND ${STAGE} NOT IN ${CUSTOMER_STAGES_SQL}`, params: [session.user.id] };
    case "my_customers":
      return { sql: ` AND c.owner_user_id = ? AND ${STAGE} IN ${CUSTOMER_STAGES_SQL}`, params: [session.user.id] };
    case "unassigned":
      return { sql: `${open} AND c.owner_user_id IS NULL`, params: [] };
    case "at_risk":
      return {
        sql: ` AND ${STAGE} IN ${CUSTOMER_STAGES_SQL} AND COALESCE(${LAST_ORDER}, '') < ?`,
        params: [new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString().slice(0, 10)],
      };
    default:
      return { sql: "", params: [] };
  }
}

function searchSql(q: string | undefined): { sql: string; params: string[] } {
  const text = normalisePersian(q ?? "").trim();
  if (!text) return { sql: "", params: [] };
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 4) return { sql: " AND (c.phone_norm LIKE ? OR c.business_name LIKE ?)", params: [`%${digits}%`, `%${text}%`] };
  return { sql: " AND (c.business_name LIKE ? OR c.area_label LIKE ? OR c.address LIKE ?)", params: [`%${text}%`, `%${text}%`, `%${text}%`] };
}

export function listBusinesses(
  session: Session,
  opts: { view: CrmView; q?: string; offset?: number; limit?: number; nowIso?: string }
): { rows: BusinessRow[]; nextOffset: number | null } {
  const now = opts.nowIso ?? new Date().toISOString();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const f = crmFilter(session, "c");
  const v = viewSql(opts.view, session, now);
  const s = searchSql(opts.q);
  const order = opts.view === "today"
    ? "t.due_at ASC, c.id"
    : "CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, c.last_activity_at DESC, c.id";
  const rows = getDb()
    .prepare(`${SELECT} WHERE c.merged_into_id IS NULL${f.sql}${v.sql}${s.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...(f.params as never[]), ...(v.params as never[]), ...(s.params as never[]), limit + 1, offset) as unknown as BusinessRow[];
  return { rows: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}

export function viewCounts(session: Session, nowIso: string = new Date().toISOString()): Record<CrmView, number> {
  const f = crmFilter(session, "c");
  const out = {} as Record<CrmView, number>;
  for (const view of CRM_VIEWS) {
    const v = viewSql(view, session, nowIso);
    out[view] = (getDb()
      .prepare(`SELECT COUNT(*) n FROM customers c LEFT JOIN tasks t ON t.id = c.next_task_id AND t.status = 'open'
                 WHERE c.merged_into_id IS NULL${f.sql}${v.sql}`)
      .get(...(f.params as never[]), ...(v.params as never[])) as { n: number }).n;
  }
  return out;
}

export function getBusiness(session: Session, id: number): BusinessRow | null {
  const row = getDb().prepare(`${SELECT} WHERE c.id = ? AND c.merged_into_id IS NULL`).get(id) as unknown as BusinessRow | undefined;
  return row && canSeeBusiness(session, row) ? row : null;
}

export function productsWithPrice(organizationId: number): FlowContext["products"] {
  return getDb()
    .prepare(`SELECT p.id, p.name,
                (SELECT pp.price_toman FROM product_prices pp WHERE pp.product_id = p.id ORDER BY pp.valid_from DESC, pp.id DESC LIMIT 1) AS price_toman
                FROM products p WHERE p.organization_id = ? AND p.active = 1 ORDER BY p.name`)
    .all(organizationId) as unknown as FlowContext["products"];
}

const asRole = (r: string | null): ContactRole => (isOneOf(CONTACT_ROLES, r) ? r : "OTHER");

export function flowContextFor(session: Session, id: number, entry: "call" | "talked_now"): { business: BusinessRow; ctx: FlowContext } | null {
  const business = getBusiness(session, id);
  if (!business) return null;
  const contacts = (getDb()
    .prepare("SELECT id, name, role FROM contacts WHERE customer_id = ? AND organization_id = ? AND active = 1 ORDER BY is_primary DESC, id LIMIT 4")
    .all(id, business.organization_id) as { id: number; name: string | null; role: string }[]).map((c) => ({ id: c.id, name: c.name, role: asRole(c.role) }));
  const first = contacts[0];
  const contactLine = first ? [first.name, CONTACT_ROLE_LABEL[first.role]].filter(Boolean).join(" · ") : "هنوز کسی را نمی‌شناسیم";
  return {
    business,
    ctx: {
      entry,
      firstContact: (business.verification ?? "unverified") === "unverified",
      attemptNo: business.attempt_count + 1,
      maxMisses: 5,
      isManager: isCrmManager(session.role),
      vars: {
        name: business.business_name,
        source: isOneOf(LEAD_SOURCES, business.source_code) ? LEAD_SOURCE_LABEL[business.source_code] : "منبع",
        contact: contactLine,
        address: business.address ?? business.area_label ?? "",
      },
      knownContacts: contacts,
      products: productsWithPrice(business.organization_id),
      reps: [],
      recentCustomers: [],
    },
  };
}

export function addLeadContext(session: Session): FlowContext {
  const db = getDb();
  const manager = isCrmManager(session.role);
  let reps: FlowContext["reps"] = [];
  if (manager) {
    const byGroup = session.role === "owner" || session.role === "platform_owner" ? "" : " AND u.group_id = ?";
    const params: number[] = [session.organizationId, ...(byGroup ? [session.groupId ?? -1] : [])];
    reps = db
      .prepare(`SELECT u.id, u.display_name AS name,
                  (SELECT COUNT(*) FROM customers c WHERE c.owner_user_id = u.id AND c.closed_at IS NULL
                     AND COALESCE(c.sales_stage, 'unknown') NOT IN ${CUSTOMER_STAGES_SQL}) AS open
                  FROM users u WHERE u.organization_id = ? AND u.role = 'salesperson' AND u.active = 1${byGroup}
                  ORDER BY u.display_name`)
      .all(...params) as unknown as FlowContext["reps"];
  }
  const f = crmFilter(session, "c");
  const recentCustomers = db
    .prepare(`SELECT c.id, c.business_name AS name FROM customers c
               WHERE c.merged_into_id IS NULL${f.sql} AND ${LAST_ORDER} IS NOT NULL
               ORDER BY ${LAST_ORDER} DESC LIMIT 6`)
    .all(...(f.params as never[])) as unknown as FlowContext["recentCustomers"];
  return {
    entry: "add_lead", firstContact: true, attemptNo: 1, maxMisses: 5, isManager: manager,
    vars: {}, knownContacts: [], products: [], reps, recentCustomers,
  };
}
```

`lib/repo/crm/dedupe.ts`

```ts
import { getDb } from "@/lib/db";
import { canSeeBusiness, type Session } from "@/lib/session";
import { namesAlike, normPhone } from "@/lib/crm/phone";
import { distanceKm } from "@/lib/geo";

export interface DupMatch {
  kind: "phone" | "name";
  reachable: boolean;
  /** null when the caller cannot see the business -- they learn only that it exists. */
  id: number | null;
  name: string | null;
  area: string | null;
  owner_name: string | null;
  distance_km: number | null;
}

interface Candidate {
  id: number; business_name: string; area_label: string | null; owner_user_id: number | null;
  group_id: number | null; organization_id: number; owner_name: string | null; lat: number | null; lng: number | null;
}
const COLS = `c.id, c.business_name, c.area_label, c.owner_user_id, c.group_id, c.organization_id, c.lat, c.lng, u.display_name AS owner_name`;

/** Searches the whole organisation (so reps cannot duplicate each other) and redacts what
 *  the caller may not see. Phone matches block creation; name matches within 300 m warn. */
export function findDuplicates(session: Session, q: { phone?: string | null; name?: string | null; lat?: number | null; lng?: number | null }): DupMatch[] {
  const db = getDb();
  const out: DupMatch[] = [];
  const seen = new Set<number>();
  const push = (kind: DupMatch["kind"], c: Candidate, distance: number | null) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const reachable = canSeeBusiness(session, c);
    out.push({ kind, reachable, id: reachable ? c.id : null, name: reachable ? c.business_name : null, area: c.area_label, owner_name: c.owner_name, distance_km: distance });
  };

  const phone = normPhone(q.phone);
  if (phone) {
    const rows = db
      .prepare(`SELECT ${COLS} FROM customers c LEFT JOIN users u ON u.id = c.owner_user_id
                 WHERE c.organization_id = ? AND c.merged_into_id IS NULL
                   AND (c.phone_norm = ? OR c.id IN (SELECT customer_id FROM contacts WHERE organization_id = ? AND phone_norm = ?))`)
      .all(session.organizationId, phone, session.organizationId, phone) as unknown as Candidate[];
    for (const r of rows) push("phone", r, null);
  }

  if (q.name && typeof q.lat === "number" && typeof q.lng === "number") {
    const rows = db
      .prepare(`SELECT ${COLS} FROM customers c LEFT JOIN users u ON u.id = c.owner_user_id
                 WHERE c.organization_id = ? AND c.merged_into_id IS NULL
                   AND c.lat BETWEEN ? AND ? AND c.lng BETWEEN ? AND ?`)
      .all(session.organizationId, q.lat - 0.004, q.lat + 0.004, q.lng - 0.005, q.lng + 0.005) as unknown as Candidate[];
    for (const r of rows) {
      if (r.lat === null || r.lng === null || !namesAlike(q.name, r.business_name)) continue;
      const d = distanceKm({ lat: q.lat, lng: q.lng }, { lat: r.lat, lng: r.lng });
      if (d <= 0.3) push("name", r, Math.round(d * 100) / 100);
    }
  }
  return out;
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-businesses-repo.test.ts` → PASS. (If `users.active` has no default of 1 in the schema, add `active` = 1 to the test's user insert.)
- [ ] **Step 5:** `git add lib/repo/crm/businesses.ts lib/repo/crm/dedupe.ts tests/crm-businesses-repo.test.ts && git commit -m "feat(crm): scoped business list, view counts, flow contexts, duplicate finder"`

---

## Task 10: The write path — flows, new leads, claim, reassign request

**Files:**
- Create: `lib/repo/crm/write.ts`
- Test: `tests/crm-write-repo.test.ts`

**Interfaces:**
- Consumes: T1–T9; `createTask` (`lib/repo/tasks.ts`); `emitEvent(orgId, { kind, entity_type, entity_id, actor_user_id, metadata })` (`lib/repo/events.ts`); `districtIdForPoint(db, lat, lng)`, `groupForPoint(db, lat, lng)` (`lib/groups.ts`); `canReachUser` (`lib/session.ts`).
- Produces: `CrmError(status, message, extra?)`, `FlowWriteInput`, `FlowWriteResult`, `recomputeState(db, customerId)`, `applyFlow(session, input)`, `applyFlowCore(session, cfg, ctx, customerId, input, opts)`, `createLead(session, { answers, clientUuid?, nowIso? })`, `claimBusiness(session, id)`, `requestReassign(session, phone)`.

Rules the implementation must hold (each is asserted below):
- Replays the answers through the same config the client rendered; an unfinished or illegal answer list is a 400.
- One transaction for: auto-claim, contact, record fixes (new phone / name / pin), closing an invalid lead, completing the opener task, dismissing the previous next task, creating the next task (moved into working hours), the activity, and the cached-state recompute.
- Events are emitted **right after COMMIT** (the rules engine opens its own transaction; a nested BEGIN would fail inside ours).
- `client_uuid` makes a retry idempotent.

- [ ] **Step 1: Write the failing test** — `tests/crm-write-repo.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-write-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { applyFlow, createLead, claimBusiness, CrmError } = await import("@/lib/repo/crm/write");
const { replayCrmState } = await import("@/lib/crm/replay");
const { ACTIVITY_FACT_COLUMNS } = await import("@/lib/repo/crm/migrate");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z"; // 09:30 Tehran
const db = getDb();
const g1 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW).lastInsertRowid);
const user = (u: string, role: string) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, role, g1, NOW).lastInsertRowid);
const repA = user("repA", "salesperson");
const repB = user("repB", "salesperson");
let n = 0;
const cust = (owner: number | null, extra: Record<string, unknown> = {}) => {
  const row = { customer_code: `W-${++n}`, business_name: `کسب‌وکار ${n}`, owner_user_id: owner, group_id: g1, synced_at: NOW, organization_id: 1,
    verification: "unverified", sales_stage: "unknown", contact_status: "not_contacted", temperature: "cold", phone_norm: `91200${String(n).padStart(5, "0")}`, ...extra };
  const k = Object.keys(row);
  return Number(db.prepare(`INSERT INTO customers (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(Object.values(row) as never[])).lastInsertRowid);
};
const openTask = (customerId: number) => {
  const id = Number(db.prepare("INSERT INTO tasks (organization_id, kind, title, entity_type, entity_id, due_at, assignee_user_id, created_at) VALUES (1,'call','تماس','customer',?,?,?,?)").run(customerId, NOW, repA, NOW).lastInsertRowid);
  db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(id, customerId);
  return id;
};
const A: Session = { user: { id: repA, display_name: "repA" } as Session["user"], role: "salesperson", groupId: g1, organizationId: 1 };
const row = (id: number) => db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<string, unknown>;
const task = (id: number) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
const replayOf = (id: number) => replayCrmState(db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(id) as never[]);
const expectStateIsReplay = (id: number) => {
  const r = row(id), s = replayOf(id);
  expect({ cs: r.contact_status, st: r.sales_stage, v: r.verification, t: r.temperature, a: r.attempt_count })
    .toEqual({ cs: s.contact_status, st: s.sales_stage, v: s.verification, t: s.temperature, a: s.attempt_count });
};

describe("applyFlow", () => {
  it("a missed call completes the opener, schedules tomorrow 10:00 and counts the attempt", () => {
    const c = cust(repA);
    const opener = openTask(c);
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", taskId: opener, nowIso: NOW,
      answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] });
    expect(task(opener)).toMatchObject({ status: "done", outcome_code: "NO_ANSWER" });
    expect(task(r.nextTaskId!)).toMatchObject({ status: "open", kind: "call", due_at: "2026-09-12T06:30:00.000Z", assignee_user_id: repA, entity_id: c });
    expect(row(c)).toMatchObject({ next_task_id: r.nextTaskId, attempt_count: 1, contact_status: "no_answer" });
    expectStateIsReplay(c);
  });

  it("a first call verifies, records the contact by role and makes the lead hot", () => {
    const c = cust(repA);
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [
      { step: "reach", option: "talked" }, { step: "verify", option: "yes" },
      { step: "who", option: "PURCHASING", value: "رضا" }, { step: "what", option: "price" },
      { step: "prods", option: "ok" }, { step: "sendnow", option: "wa" },
    ] });
    expect(row(c)).toMatchObject({ verification: "verified", sales_stage: "interested", temperature: "hot", contact_status: "contacted", lifecycle: "qualified" });
    expect(db.prepare("SELECT name, role, is_primary, is_decider FROM contacts WHERE customer_id = ?").get(c)).toEqual({ name: "رضا", role: "PURCHASING", is_primary: 1, is_decider: 1 });
    expect(task(r.nextTaskId!)).toMatchObject({ kind: "quote_followup", priority: "HIGH" });
    expect(r.acc.share).toBe("whatsapp");
    expectStateIsReplay(c);
  });

  it("keeps exactly one open next action", () => {
    const c = cust(repA);
    const old = openTask(c);
    applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [{ step: "reach", option: "busy" }, { step: "noans", option: "h2" }] });
    expect(task(old).status).toBe("dismissed");
    expect((db.prepare("SELECT COUNT(*) n FROM tasks WHERE entity_id = ? AND status = 'open'").get(c) as { n: number }).n).toBe(1);
  });

  it("moves the next action into working hours", () => {
    const c = cust(repA, { working_hours_json: JSON.stringify([{ days: [0, 1, 2, 3, 4, 5, 6], from: "12:00", to: "16:00" }]) });
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] });
    expect(task(r.nextTaskId!).due_at).toBe("2026-09-12T08:30:00.000Z");
  });

  it("closes an invalid lead with no next action", () => {
    const c = cust(repA);
    const old = openTask(c);
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [
      { step: "reach", option: "talked" }, { step: "verify", option: "closed" }, { step: "closed", option: "yes" }] });
    expect(r.nextTaskId).toBeNull();
    expect(row(c)).toMatchObject({ verification: "invalid_closed", lost_reason_code: "CLOSED", next_task_id: null });
    expect(row(c).closed_at).toBeTruthy();
    expect(task(old).status).toBe("dismissed");
  });

  it("auto-claims an unassigned lead in the rep's group", () => {
    const c = cust(null);
    applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] });
    expect(row(c).owner_user_id).toBe(repA);
    expect(db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'owner_change'").get(c)).toEqual({ n: 1 });
  });

  it("404s another rep's business and 400s an unfinished flow", () => {
    const c = cust(repB);
    expect(() => applyFlow(A, { customerId: c, entry: "call", channel: "call", answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] }))
      .toThrow(expect.objectContaining({ status: 404 }));
    const mine = cust(repA);
    expect(() => applyFlow(A, { customerId: mine, entry: "call", channel: "call", answers: [{ step: "reach", option: "no_answer" }] }))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  it("is idempotent on client_uuid", () => {
    const c = cust(repA);
    const input = { customerId: c, entry: "call" as const, channel: "call" as const, nowIso: NOW, clientUuid: "u-1",
      answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] };
    const a = applyFlow(A, input);
    const b = applyFlow(A, input);
    expect(b.activityId).toBe(a.activityId);
    expect(row(c).attempt_count).toBe(1);
  });
});

describe("createLead", () => {
  const LINK = JSON.stringify({ name: "کافه نو", lat: 35.7, lng: 51.4, address: "ونک، ملاصدرا", maps_url: "https://maps.app.goo.gl/x" });
  const basics = (phone: string, branch_of: number | null = null) => JSON.stringify({ name: "کافه نو", phone, branch_of });
  const HOURS = JSON.stringify([{ days: [0, 1, 2, 3, 4, 5, 6], from: "12:00", to: "23:00" }]);
  const answers = (b: string, first = "call_t10") => [
    { step: "src", option: "SNAPPFOOD" }, { step: "link", option: "ok", value: LINK }, { step: "basics", option: "ok", value: b },
    { step: "type", option: "CAFE" }, { step: "price", option: "high" }, { step: "hours", option: "ok", value: HOURS }, { step: "first", option: first },
  ];

  it("creates the business with source, tier, hours, owner and a first call", () => {
    const r = createLead(A, { answers: answers(basics("0912 999 0001")), nowIso: NOW });
    expect(row(r.id)).toMatchObject({ business_name: "کافه نو", phone_norm: "9129990001", source_code: "SNAPPFOOD", business_type: "CAFE",
      customer_type: "CAFE", price_tier: "high", owner_user_id: repA, group_id: g1, lifecycle: "lead", verification: "unverified",
      location_precision: "exact", maps_url: "https://maps.app.goo.gl/x", next_task_id: r.nextTaskId });
    expect(JSON.parse(row(r.id).working_hours_json as string)).toHaveLength(1);
    expect(task(r.nextTaskId!)).toMatchObject({ kind: "call", due_at: "2026-09-12T08:30:00.000Z" }); // moved to 12:00
    expect(db.prepare("SELECT type FROM activities WHERE customer_id = ?").get(r.id)).toEqual({ type: "lead_created" });
  });

  it("refuses a phone that already exists, unless it is declared a branch", () => {
    const first = createLead(A, { answers: answers(basics("0912 999 0002")), nowIso: NOW });
    expect(() => createLead(A, { answers: answers(basics("09129990002")), nowIso: NOW })).toThrow(expect.objectContaining({ status: 409 }));
    const branch = createLead(A, { answers: answers(basics("09129990002", first.id)), nowIso: NOW });
    expect(row(branch.id).parent_customer_id).toBe(first.id);
  });

  it("sends a phone-less lead to a driver visit", () => {
    const r = createLead(A, { answers: answers(basics(""), "driver"), nowIso: NOW });
    expect(row(r.id).phone_norm).toBeNull();
    expect(task(r.nextTaskId!)).toMatchObject({ kind: "verify_visit", role_hint: "driver", assignee_user_id: null, group_id: g1 });
  });

  it("422s without a usable location", () => {
    const bad = [
      { step: "src", option: "FIELD_VISIT" }, { step: "here", option: "nothere" }, { step: "basics", option: "ok", value: basics("") },
      { step: "loc", option: "map" }, { step: "pin", option: "ok", value: "{}" }, { step: "type", option: "CAFE" },
      { step: "price", option: "unknown" }, { step: "hours", option: "skip" }, { step: "first", option: "self" },
    ];
    expect(() => createLead(A, { answers: bad, nowIso: NOW })).toThrow(expect.objectContaining({ status: 422 }));
  });
});

describe("claimBusiness", () => {
  it("claims the pool, refuses someone else's", () => {
    const pool = cust(null);
    claimBusiness(A, pool);
    expect(row(pool).owner_user_id).toBe(repA);
    expect(() => claimBusiness(A, cust(repB))).toThrow(CrmError);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-write-repo.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/repo/crm/write.ts`

```ts
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { canReachUser, canSeeBusiness, canWriteBusiness, isCrmManager, type Session } from "@/lib/session";
import { createTask } from "@/lib/repo/tasks";
import { emitEvent, type EventInput } from "@/lib/repo/events";
import { districtIdForPoint, groupForPoint } from "@/lib/groups";
import { OUTCOMES, type OutcomeCode } from "@/lib/crm/outcomes";
import { replayCrmState } from "@/lib/crm/replay";
import { lifecycleFor } from "@/lib/crm/stage";
import { resolveDue } from "@/lib/crm/due";
import { nextOpenAt, parseHours } from "@/lib/crm/hours";
import { normPhone } from "@/lib/crm/phone";
import { customerTypeFor, isDecider, isInvalid, type Verification } from "@/lib/crm/vocab";
import { FlowError, interpolate, replayAnswers } from "@/lib/crm/flows/machine";
import type { FlowAnswer, FlowConfig, FlowContext, FlowSet, FlowState } from "@/lib/crm/flows/types";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { addLeadFlow, basicsOf, hoursOf, linkOf, pinOf, type PinValue } from "@/lib/crm/flows/addLead";
import type { CustomerLifecycle } from "@/lib/types";
import { ACTIVITY_FACT_COLUMNS } from "./migrate";
import { addLeadContext, flowContextFor, getBusiness } from "./businesses";
import { findDuplicates } from "./dedupe";

export class CrmError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export interface FlowWriteInput {
  customerId: number;
  answers: FlowAnswer[];
  entry: "call" | "talked_now";
  channel: "call" | "visit";
  taskId?: number | null;
  clientUuid?: string | null;
  nowIso?: string;
  /** Driver visits only: where the phone was when the driver saved. */
  driverPos?: { lat: number; lng: number; accuracy: number } | null;
}
export interface FlowWriteResult { customerId: number; activityId: number; nextTaskId: number | null; acc: FlowSet }

interface Core {
  id: number; organization_id: number; business_name: string; owner_user_id: number | null; group_id: number | null;
  phone_norm: string | null; attempt_count: number; next_task_id: number | null; lifecycle: CustomerLifecycle;
  temperature: string | null; temperature_manual: number; verification: string | null; sales_stage: string | null;
  working_hours_json: string | null;
}
const loadCore = (db: DatabaseSync, id: number): Core | undefined =>
  db.prepare(`SELECT id, organization_id, business_name, owner_user_id, group_id, phone_norm, COALESCE(attempt_count, 0) AS attempt_count,
                     next_task_id, lifecycle, temperature, COALESCE(temperature_manual, 0) AS temperature_manual, verification,
                     sales_stage, working_hours_json
                FROM customers WHERE id = ? AND merged_into_id IS NULL`).get(id) as unknown as Core | undefined;

interface ActivityInsert {
  customerId: number; userId: number | null; type: string; at: string;
  contactId?: number | null; outcome?: string | null; attemptNo?: number | null; phoneUsed?: string | null; note?: string | null;
  answers?: unknown; contact_status_to?: string | null; stage_to?: string | null; verification_to?: string | null; signal?: string | null;
  attempt?: boolean; miss?: boolean; talked?: boolean; completedTaskId?: number | null; nextTaskId?: number | null; clientUuid?: string | null;
}
function insertActivity(db: DatabaseSync, org: number, a: ActivityInsert): number {
  return Number(db.prepare(`INSERT INTO activities
      (organization_id, customer_id, user_id, contact_id, type, outcome_code, attempt_no, phone_used, note, answers_json,
       contact_status_to, stage_to, verification_to, signal, attempt, miss, talked, completed_task_id, next_task_id, client_uuid, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(org, a.customerId, a.userId, a.contactId ?? null, a.type, a.outcome ?? null, a.attemptNo ?? null, a.phoneUsed ?? null,
      a.note ?? null, a.answers === undefined ? null : JSON.stringify(a.answers), a.contact_status_to ?? null, a.stage_to ?? null,
      a.verification_to ?? null, a.signal ?? null, a.attempt ? 1 : 0, a.miss ? 1 : 0, a.talked ? 1 : 0,
      a.completedTaskId ?? null, a.nextTaskId ?? null, a.clientUuid ?? null, a.at, new Date().toISOString()).lastInsertRowid);
}

/** Rebuild the cached columns from the activities -- the replay guarantee (spec D9). */
export function recomputeState(db: DatabaseSync, customerId: number): void {
  const acts = db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(customerId) as never[];
  const s = replayCrmState(acts);
  const c = db.prepare("SELECT lifecycle, COALESCE(temperature_manual, 0) AS manual, temperature FROM customers WHERE id = ?").get(customerId) as
    { lifecycle: CustomerLifecycle; manual: number; temperature: string | null };
  db.prepare(`UPDATE customers SET contact_status = ?, sales_stage = ?, verification = ?, temperature = ?, attempt_count = ?,
                consecutive_misses = ?, last_activity_at = ?, last_contacted_at = ?, lifecycle = ? WHERE id = ?`)
    .run(s.contact_status, s.sales_stage, s.verification, c.manual ? c.temperature : s.temperature, s.attempt_count,
      s.consecutive_misses, s.last_activity_at, s.last_contacted_at, lifecycleFor(s.sales_stage, c.lifecycle), customerId);
}

function setLocation(db: DatabaseSync, id: number, lat: number, lng: number, precision: "exact" | "approx"): void {
  db.prepare("UPDATE customers SET lat = ?, lng = ?, location_precision = ?, district_id = ? WHERE id = ?")
    .run(lat, lng, precision, districtIdForPoint(db, lat, lng), id);
}

function parsePin(v: string | undefined): PinValue | null {
  return pinOf(v ? { pin: v } : {});
}

/** The one open next action. Picked dates come from the last answer that carried one;
 *  the time is moved into the business's working hours. */
function openNextTask(session: Session, core: Core, acc: FlowSet, st: FlowState, ctx: FlowContext, at: string): number | null {
  if (!acc.due || acc.due.kind === "none") return null;
  const picked = [...st.answers].reverse().find((a) => a.value && /^\d{4}-\d{2}-\d{2}$/.test(a.value))?.value ?? null;
  const raw = resolveDue(acc.due, at, picked);
  if (!raw) throw new CrmError(400, "روز را انتخاب کنید");
  const due = nextOpenAt(parseHours(core.working_hours_json), raw);
  let assignee = core.owner_user_id;
  let roleHint: string | null = assignee ? null : "salesperson";
  if (acc.next_assignee === "group_manager") { assignee = null; roleHint = "group_manager"; }
  if (acc.next_assignee === "driver_pool") { assignee = null; roleHint = "driver"; }
  return createTask(core.organization_id, {
    title: `${interpolate(acc.next_title ?? "پیگیری", ctx, acc)} · ${core.business_name}`,
    kind: acc.next_kind ?? "call",
    assignee_user_id: assignee,
    role_hint: roleHint,
    group_id: core.group_id,
    entity_type: "customer",
    entity_id: core.id,
    due_at: due,
    priority: core.temperature === "hot" || acc.outcome === "ASKED_PRICE" || acc.outcome === "REQUESTED_SAMPLE" || acc.outcome === "NEGOTIATING" ? "HIGH" : "NORMAL",
    created_by: session.user.id,
  });
}

function replayOr400(cfg: FlowConfig, ctx: FlowContext, answers: FlowAnswer[]): FlowState {
  let st: FlowState;
  try {
    st = replayAnswers(cfg, ctx, Array.isArray(answers) ? answers : []);
  } catch (e) {
    if (e instanceof FlowError) throw new CrmError(400, "پاسخ‌ها با پرسش‌ها جور نیست");
    throw e;
  }
  if (!st.saved) throw new CrmError(400, "پاسخ‌ها کامل نیست");
  return st;
}

const emitAll = (org: number, events: EventInput[]) => { for (const e of events) emitEvent(org, e); };

export function applyFlow(session: Session, input: FlowWriteInput): FlowWriteResult {
  const db = getDb();
  const core = loadCore(db, input.customerId);
  if (!core || !canSeeBusiness(session, core)) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  if (!canWriteBusiness(session, core)) throw new CrmError(403, "دسترسی لازم را ندارید");
  const fc = flowContextFor(session, core.id, input.entry)!;
  return applyFlowCore(session, afterCallFlow, fc.ctx, core.id, input, { claim: true });
}

/** Shared by applyFlow and the driver visit. The caller has already checked access. */
export function applyFlowCore(
  session: Session, cfg: FlowConfig, ctx: FlowContext, customerId: number, input: FlowWriteInput, opts: { claim: boolean }
): FlowWriteResult {
  const db = getDb();
  const core = loadCore(db, customerId);
  if (!core) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  const st = replayOr400(cfg, ctx, input.answers);
  const acc = st.acc;
  const at = input.nowIso ?? new Date().toISOString();
  const org = core.organization_id;

  if (input.clientUuid) {
    const dup = db.prepare("SELECT id, next_task_id FROM activities WHERE organization_id = ? AND client_uuid = ?").get(org, input.clientUuid) as
      { id: number; next_task_id: number | null } | undefined;
    if (dup) return { customerId, activityId: dup.id, nextTaskId: dup.next_task_id, acc };
  }

  const newPhone = normPhone(st.values.new_phone);
  if (st.values.new_phone && !newPhone) throw new CrmError(400, "شماره تلفن معتبر نیست");
  const events: EventInput[] = [];
  const base = { entity_type: "customer", entity_id: customerId, actor_user_id: session.user.id };

  db.exec("BEGIN IMMEDIATE");
  let activityId: number;
  let nextTaskId: number | null;
  try {
    let owner = core.owner_user_id;
    if (opts.claim && owner === null && session.role === "salesperson") {
      db.prepare("UPDATE customers SET owner_user_id = ? WHERE id = ?").run(session.user.id, customerId);
      owner = session.user.id;
      insertActivity(db, org, { customerId, userId: session.user.id, type: "owner_change", note: "برداشتن از استخر گروه", at });
      events.push({ ...base, kind: "lead.claimed" });
    }

    let contactId: number | null = null;
    if (acc.contact_id) {
      if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND customer_id = ?").get(acc.contact_id, customerId)) throw new CrmError(400, "مخاطب نامعتبر است");
      contactId = acc.contact_id;
    } else if (acc.contact_role) {
      const hasPrimary = !!db.prepare("SELECT 1 FROM contacts WHERE customer_id = ? AND is_primary = 1 AND active = 1").get(customerId);
      contactId = Number(db.prepare(`INSERT INTO contacts (organization_id, customer_id, name, role, is_primary, is_decider, created_by, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(org, customerId, st.values.contact_name?.trim() || null, acc.contact_role, hasPrimary ? 0 : 1, isDecider(acc.contact_role) ? 1 : 0, session.user.id, at, at).lastInsertRowid);
    }

    if (newPhone) {
      db.prepare("UPDATE customers SET phone = ?, phone_norm = ? WHERE id = ?").run(`0${newPhone}`, newPhone, customerId);
      if (contactId) db.prepare("UPDATE contacts SET phone = ?, phone_norm = ? WHERE id = ? AND phone_norm IS NULL").run(`0${newPhone}`, newPhone, contactId);
    }
    const newName = st.values.new_name?.trim();
    if (newName) db.prepare("UPDATE customers SET business_name = ? WHERE id = ?").run(newName, customerId);
    const moved = parsePin(st.values.movedpin);
    if (moved) setLocation(db, customerId, moved.lat, moved.lng, moved.precision);
    const pos = input.driverPos;
    if (pos && acc.verification === "verified" && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) && pos.accuracy <= 60) setLocation(db, customerId, pos.lat, pos.lng, "exact");
    if (acc.invalid) db.prepare("UPDATE customers SET closed_at = ?, lost_reason_code = COALESCE(?, lost_reason_code) WHERE id = ?").run(at, acc.lost_reason ?? null, customerId);
    else if (acc.lost_reason) db.prepare("UPDATE customers SET lost_reason_code = ? WHERE id = ?").run(acc.lost_reason, customerId);

    const outcome: OutcomeCode | null = acc.outcome ?? (acc.contact_role ? "TALKED" : null);
    if (input.taskId) {
      db.prepare(`UPDATE tasks SET status = 'done', outcome_code = ?, done_at = ?
                   WHERE id = ? AND organization_id = ? AND entity_type = 'customer' AND entity_id = ? AND status = 'open'`)
        .run(outcome, at, input.taskId, org, customerId);
    }

    nextTaskId = acc.invalid ? null : openNextTask(session, { ...core, owner_user_id: owner, business_name: newName || core.business_name }, acc, st, ctx, at);
    if (core.next_task_id && core.next_task_id !== input.taskId) {
      db.prepare("UPDATE tasks SET status = 'dismissed' WHERE id = ? AND status = 'open'").run(core.next_task_id);
    }
    db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(nextTaskId, customerId);

    const o = outcome ? OUTCOMES[outcome] : null;
    activityId = insertActivity(db, org, {
      customerId, userId: session.user.id, contactId, type: input.channel, outcome,
      attemptNo: o?.attempt ? core.attempt_count + 1 : null, phoneUsed: input.channel === "call" ? core.phone_norm : null,
      answers: { answers: input.answers, skip: acc.skip_reason ?? null, product_id: acc.product_id ?? null, sample_qty: acc.sample_qty ?? null },
      contact_status_to: o?.contact_status ?? null, stage_to: o?.stage ?? null, verification_to: acc.verification ?? null, signal: o?.signal ?? null,
      attempt: !!o?.attempt, miss: !!o?.miss, talked: !!o?.talked, completedTaskId: input.taskId ?? null, nextTaskId,
      clientUuid: input.clientUuid ?? null, at,
    });
    recomputeState(db, customerId);

    const after = loadCore(db, customerId)!;
    events.push({ ...base, kind: "activity.logged", metadata: { activity_id: activityId, outcome, channel: input.channel } });
    if (after.verification !== core.verification && after.verification) {
      events.push({ ...base, kind: isInvalid(after.verification as Verification) ? "lead.invalidated" : "lead.verified", metadata: { from: core.verification, to: after.verification } });
    }
    if (after.sales_stage !== core.sales_stage) events.push({ ...base, kind: "stage.changed", metadata: { from: core.sales_stage, to: after.sales_stage } });
    if (after.temperature !== core.temperature) events.push({ ...base, kind: "temperature.changed", metadata: { from: core.temperature, to: after.temperature } });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  emitAll(org, events);
  return { customerId, activityId, nextTaskId, acc };
}

const CRM_ROLES = new Set(["platform_owner", "owner", "group_manager", "rep_manager", "salesperson"]);

export function createLead(session: Session, input: { answers: FlowAnswer[]; clientUuid?: string | null; nowIso?: string }): { id: number; nextTaskId: number | null; acc: FlowSet } {
  if (!CRM_ROLES.has(session.role)) throw new CrmError(403, "دسترسی لازم را ندارید");
  const db = getDb();
  const at = input.nowIso ?? new Date().toISOString();
  const org = session.organizationId;
  const ctx = addLeadContext(session);
  const st = replayOr400(addLeadFlow, ctx, input.answers);
  const acc = st.acc;

  if (input.clientUuid) {
    const existing = db.prepare("SELECT id, next_task_id FROM customers WHERE organization_id = ? AND client_uuid = ?").get(org, input.clientUuid) as
      { id: number; next_task_id: number | null } | undefined;
    if (existing) return { id: existing.id, nextTaskId: existing.next_task_id, acc };
  }

  const basics = basicsOf(st.values);
  const name = basics?.name.trim() ?? "";
  if (name.length < 2) throw new CrmError(400, "نام کسب‌وکار لازم است");
  const pin = pinOf(st.values);
  if (!pin) throw new CrmError(422, "مکان کسب‌وکار لازم است");
  const phone = normPhone(basics?.phone);
  if (basics?.phone?.trim() && !phone) throw new CrmError(400, "شماره تلفن معتبر نیست");
  if (phone) {
    const matches = findDuplicates(session, { phone }).filter((m) => m.kind === "phone");
    const branchOk = basics?.branch_of != null && matches.some((m) => m.reachable && m.id === basics.branch_of);
    if (matches.length && !branchOk) throw new CrmError(409, "این شماره قبلاً ثبت شده است", { matches });
  }

  let owner: number | null = session.user.id;
  if (isCrmManager(session.role)) {
    if (acc.owner === "pool") owner = null;
    else if (typeof acc.owner === "number") {
      const u = db.prepare("SELECT role FROM users WHERE id = ? AND organization_id = ? AND active = 1").get(acc.owner, org) as { role: string } | undefined;
      if (!u || u.role !== "salesperson" || !canReachUser(session, acc.owner)) throw new CrmError(400, "فروشنده نامعتبر است");
      owner = acc.owner;
    }
  }
  const groupId = session.role === "salesperson" ? session.groupId : groupForPoint(db, pin.lat, pin.lng) ?? session.groupId;
  const districtId = districtIdForPoint(db, pin.lat, pin.lng);
  const area = districtId ? (db.prepare("SELECT name FROM districts WHERE id = ?").get(districtId) as { name: string } | undefined)?.name ?? null : null;
  const link = linkOf(st.values);
  const hours = hoursOf(st.values);
  const referred = acc.referred_by && getBusiness(session, acc.referred_by) ? acc.referred_by : null;
  const businessType = acc.business_type ?? "OTHER";
  const verification: Verification = acc.verification ?? "unverified";
  const events: EventInput[] = [];

  db.exec("BEGIN IMMEDIATE");
  let id: number;
  let nextTaskId: number | null;
  try {
    const code = `CRM-${at.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
    id = Number(db.prepare(`INSERT INTO customers
        (customer_code, business_name, phone, phone_norm, address, area_label, lat, lng, location_precision, district_id, maps_url,
         source_code, source_detail, source_url, referred_by_customer_id, parent_customer_id, business_type, customer_type, price_tier,
         working_hours_json, owner_user_id, group_id, lifecycle, verification, contact_status, sales_stage, temperature, client_uuid,
         synced_at, organization_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, 'not_contacted', 'unknown', 'cold', ?, ?, ?)`)
      .run(code, name, phone ? `0${phone}` : null, phone, pin.address ?? link?.address ?? null, area, pin.lat, pin.lng, pin.precision,
        districtId, link?.maps_url ?? null, acc.source ?? "OTHER", st.values.source_detail?.trim() || null, link?.maps_url ?? null,
        referred, basics?.branch_of ?? null, businessType, customerTypeFor(businessType), acc.price_tier ?? "unknown",
        hours.length ? JSON.stringify(hours) : null, owner, groupId, verification, input.clientUuid ?? null, at, org).lastInsertRowid);

    insertActivity(db, org, { customerId: id, userId: session.user.id, type: "lead_created", verification_to: verification, answers: { answers: input.answers }, at });
    const core = loadCore(db, id)!;
    nextTaskId = openNextTask(session, core, acc, st, { ...ctx, vars: { name } }, at);
    db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(nextTaskId, id);
    recomputeState(db, id);
    events.push({ kind: "lead.created", entity_type: "customer", entity_id: id, actor_user_id: session.user.id, metadata: { source: acc.source ?? null } });
    if (verification === "verified") events.push({ kind: "lead.verified", entity_type: "customer", entity_id: id, actor_user_id: session.user.id });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  emitAll(org, events);
  return { id, nextTaskId, acc };
}

export function claimBusiness(session: Session, id: number): void {
  const db = getDb();
  const core = loadCore(db, id);
  if (!core || !canSeeBusiness(session, core)) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  if (session.role !== "salesperson" || core.owner_user_id !== null) throw new CrmError(409, "این کسب‌وکار صاحب دارد");
  const at = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE customers SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL").run(session.user.id, id);
    insertActivity(db, core.organization_id, { customerId: id, userId: session.user.id, type: "owner_change", note: "برداشتن از استخر گروه", at });
    if (core.next_task_id) db.prepare("UPDATE tasks SET assignee_user_id = ? WHERE id = ? AND status = 'open' AND assignee_user_id IS NULL").run(session.user.id, core.next_task_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  emitEvent(core.organization_id, { kind: "lead.claimed", entity_type: "customer", entity_id: id, actor_user_id: session.user.id });
}

/** A rep found a phone that belongs to a business they cannot see: ask its group's manager. */
export function requestReassign(session: Session, phoneRaw: string): { taskId: number } {
  const phone = normPhone(phoneRaw);
  if (!phone) throw new CrmError(400, "شماره تلفن معتبر نیست");
  const db = getDb();
  const target = db.prepare("SELECT id, business_name, group_id FROM customers WHERE organization_id = ? AND phone_norm = ? AND merged_into_id IS NULL LIMIT 1")
    .get(session.organizationId, phone) as { id: number; business_name: string; group_id: number | null } | undefined;
  if (!target) throw new CrmError(404, "کسب‌وکاری با این شماره پیدا نشد");
  const taskId = createTask(session.organizationId, {
    title: `درخواست واگذاری «${target.business_name}» به ${session.user.display_name}`,
    kind: "outreach", role_hint: "group_manager", group_id: target.group_id, entity_type: "customer", entity_id: target.id,
    due_at: new Date().toISOString(), priority: "NORMAL", created_by: session.user.id,
  });
  emitEvent(session.organizationId, { kind: "reassign.requested", entity_type: "customer", entity_id: target.id, actor_user_id: session.user.id });
  return { taskId };
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-write-repo.test.ts` → PASS. Then `npx vitest run tests/crm-*.test.ts tests/repo-boundary.test.ts tests/no-raw-enum-copy.test.ts`. The enum test will fail until Task 13 labels `verify_visit` / `sample_delivery` / `quote_followup` only if it scans `lib/repo/crm` — it scans `kind: "…"` literals on lines containing `role_hint` and whole files under `lib/tasks/`, `lib/repo/tasks|board|pocket.ts`; `requestReassign` creates `outreach`, which is labelled. If it fails, do Task 13 Step 3 now.
- [ ] **Step 5:** `git add lib/repo/crm/write.ts tests/crm-write-repo.test.ts && git commit -m "feat(crm): single write path -- flows, new leads, claim, reassign request"`

---

## Task 11: Driver verification visits (repo)

**Files:**
- Create: `lib/repo/crm/driverVisits.ts`
- Test: `tests/crm-driver-visits.test.ts`

**Interfaces:**
- Consumes: `applyFlowCore`, `CrmError` (T10); `driverVisitFlow` (T6); `formatHours`, `parseHours` (T3); `EMPTY_CONTEXT` (T5).
- Produces: `DriverVisit`, `driverVisitsFor(session)`, `applyDriverVisit(session, taskId, { answers, pos?, nowIso? })`.

A driver sees only open `verify_visit` tasks assigned to them, or unassigned with `role_hint='driver'` in their own group — and of the business only what finds the door.

- [ ] **Step 1: Write the failing test** — `tests/crm-driver-visits.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-driver-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { driverVisitsFor, applyDriverVisit } = await import("@/lib/repo/crm/driverVisits");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z";
const db = getDb();
const g = (s: string) => Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?,?,?,1)").run(s, s, NOW).lastInsertRowid);
const g1 = g("g1"), g2 = g("g2");
const user = (u: string, role: string, gid: number) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, role, gid, NOW).lastInsertRowid);
const rep = user("rep", "salesperson", g1);
const driver = user("drv", "driver", g1);
const lead = (gid: number) => {
  const id = Number(db.prepare(`INSERT INTO customers (customer_code, business_name, address, lat, lng, location_precision, owner_user_id, group_id,
      verification, sales_stage, contact_status, temperature, synced_at, organization_id)
      VALUES (?, 'رستوران بی‌تلفن', 'سعادت‌آباد', 35.78, 51.37, 'approx', ?, ?, 'unverified', 'unknown', 'not_contacted', 'cold', ?, 1)`)
    .run(`D-${Math.random()}`, rep, gid, NOW).lastInsertRowid);
  const t = Number(db.prepare(`INSERT INTO tasks (organization_id, role_hint, group_id, kind, title, entity_type, entity_id, due_at, created_at)
      VALUES (1, 'driver', ?, 'verify_visit', 'بازدید تأیید', 'customer', ?, ?, ?)`).run(gid, id, NOW, NOW).lastInsertRowid);
  db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(t, id);
  return { id, t };
};
const mine = lead(g1);
const elsewhere = lead(g2);
const D: Session = { user: { id: driver, display_name: "drv" } as Session["user"], role: "driver", groupId: g1, organizationId: 1 };

describe("driver visits", () => {
  it("lists only the driver's group's visits, with the minimum to find the door", () => {
    const v = driverVisitsFor(D);
    expect(v.map((x) => x.task_id)).toEqual([mine.t]);
    expect(Object.keys(v[0]).sort()).toEqual(["address", "area_label", "business_name", "customer_id", "due_at", "hours", "lat", "lng", "maps_url", "task_id"]);
  });

  it("verifies the lead, fixes the pin from the driver's GPS, saves the phone and hands it back to the rep", () => {
    const r = applyDriverVisit(D, mine.t, { nowIso: NOW, pos: { lat: 35.781, lng: 51.371, accuracy: 20 }, answers: [
      { step: "found", option: "yes" }, { step: "open", option: "yes" }, { step: "phone", option: "ok", value: "0912 777 0001" },
      { step: "who", option: "OWNER" }, { step: "interest", option: "yes" },
    ] });
    const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(mine.id) as Record<string, unknown>;
    expect(c).toMatchObject({ verification: "verified", phone_norm: "9127770001", lat: 35.781, lng: 51.371, location_precision: "exact", temperature: "warm" });
    expect(db.prepare("SELECT status FROM tasks WHERE id = ?").get(mine.t)).toEqual({ status: "done" });
    expect(db.prepare("SELECT kind, assignee_user_id FROM tasks WHERE id = ?").get(r.nextTaskId!)).toEqual({ kind: "call", assignee_user_id: rep });
  });

  it("404s a visit in another group and refuses a non-driver", () => {
    expect(() => applyDriverVisit(D, elsewhere.t, { answers: [{ step: "found", option: "no" }, { step: "notfound", option: "gone" }] }))
      .toThrow(expect.objectContaining({ status: 404 }));
    const R: Session = { ...D, user: { id: rep } as Session["user"], role: "salesperson" };
    expect(() => driverVisitsFor(R)).toThrow(expect.objectContaining({ status: 403 }));
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-driver-visits.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/repo/crm/driverVisits.ts`

```ts
import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { formatHours, parseHours } from "@/lib/crm/hours";
import { EMPTY_CONTEXT, type FlowAnswer } from "@/lib/crm/flows/types";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";
import { applyFlowCore, CrmError, type FlowWriteResult } from "./write";

export interface DriverVisit {
  task_id: number; customer_id: number; business_name: string; address: string | null; area_label: string | null;
  lat: number | null; lng: number | null; maps_url: string | null; hours: string; due_at: string | null;
}

const VISIBLE = `t.organization_id = ? AND t.kind = 'verify_visit' AND t.status = 'open' AND t.entity_type = 'customer'
  AND (t.assignee_user_id = ? OR (t.assignee_user_id IS NULL AND t.role_hint = 'driver' AND t.group_id = ?))`;

export function driverVisitsFor(session: Session): DriverVisit[] {
  if (session.role !== "driver") throw new CrmError(403, "دسترسی لازم را ندارید");
  const rows = getDb()
    .prepare(`SELECT t.id AS task_id, c.id AS customer_id, c.business_name, c.address, c.area_label, c.lat, c.lng, c.maps_url,
                     c.working_hours_json, t.due_at
                FROM tasks t JOIN customers c ON c.id = t.entity_id
               WHERE ${VISIBLE} AND c.closed_at IS NULL
               ORDER BY COALESCE(t.due_at, '9999'), t.id`)
    .all(session.organizationId, session.user.id, session.groupId ?? -1) as unknown as (Omit<DriverVisit, "hours"> & { working_hours_json: string | null })[];
  return rows.map(({ working_hours_json, ...r }) => ({ ...r, hours: formatHours(parseHours(working_hours_json)) }));
}

export function applyDriverVisit(
  session: Session, taskId: number,
  input: { answers: FlowAnswer[]; pos?: { lat: number; lng: number; accuracy: number } | null; nowIso?: string; clientUuid?: string | null }
): FlowWriteResult {
  if (session.role !== "driver") throw new CrmError(403, "دسترسی لازم را ندارید");
  const t = getDb()
    .prepare(`SELECT t.entity_id AS customer_id, c.business_name, c.address, c.area_label FROM tasks t JOIN customers c ON c.id = t.entity_id WHERE t.id = ? AND ${VISIBLE}`)
    .get(taskId, session.organizationId, session.user.id, session.groupId ?? -1) as
    { customer_id: number; business_name: string; address: string | null; area_label: string | null } | undefined;
  if (!t) throw new CrmError(404, "بازدید پیدا نشد");
  const ctx = { ...EMPTY_CONTEXT, entry: "driver_visit" as const, vars: { name: t.business_name, address: t.address ?? t.area_label ?? "" } };
  return applyFlowCore(session, driverVisitFlow, ctx, t.customer_id,
    { customerId: t.customer_id, answers: input.answers, entry: "call", channel: "visit", taskId, nowIso: input.nowIso, driverPos: input.pos ?? null, clientUuid: input.clientUuid },
    { claim: false });
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-driver-visits.test.ts` → PASS.
- [ ] **Step 5:** `git add lib/repo/crm/driverVisits.ts tests/crm-driver-visits.test.ts && git commit -m "feat(crm): driver verification visits"`

---

## Task 12: API routes and the proxy

**Files:**
- Create: `app/api/crm/businesses/route.ts`, `app/api/crm/businesses/dedupe/route.ts`, `app/api/crm/businesses/[id]/context/route.ts`, `app/api/crm/businesses/[id]/flow/route.ts`, `app/api/crm/businesses/[id]/claim/route.ts`, `app/api/crm/add-lead/context/route.ts`, `app/api/crm/resolve-link/route.ts`, `app/api/crm/reassign-request/route.ts`, `app/api/crm/driver-visits/route.ts`, `app/api/crm/driver-visits/[taskId]/route.ts`, `lib/crm/linkName.ts`, `lib/repo/crm/http.ts`
- Modify: `proxy.ts` (after the `isCheques` block)
- Test: `tests/crm-link-name.test.ts`, `tests/proxy.test.ts` (append)

**Interfaces:**
- Consumes: T9–T11; `requireRole(req, roles)`; `resolveMapsLink(url, fallbackName)` from `lib/resolveMapsLink.ts` → `{ lat, lng, address, resolvedUrl }`.
- Produces (HTTP):
  - `GET /api/crm/businesses?view&q&offset` → `{ ok, rows: BusinessRow[], counts, next_offset }`
  - `POST /api/crm/businesses` `{ answers, client_uuid? }` → `201 { ok, id, next_task_id }` | `409 { ok:false, error, matches }` | `422` | `400`
  - `GET /api/crm/businesses/dedupe?phone&name&lat&lng` → `{ ok, matches: DupMatch[] }`
  - `GET /api/crm/businesses/[id]/context?entry=call|talked_now` → `{ ok, business, ctx }`
  - `POST /api/crm/businesses/[id]/flow` `{ answers, entry, task_id?, client_uuid? }` → `{ ok, activity_id, next_task_id }`
  - `POST /api/crm/businesses/[id]/claim` → `{ ok }`
  - `GET /api/crm/add-lead/context` → `{ ok, ctx }`
  - `POST /api/crm/resolve-link` `{ url }` → `{ ok, link: LinkValue }`
  - `POST /api/crm/reassign-request` `{ phone }` → `{ ok }`
  - `GET /api/crm/driver-visits` → `{ ok, visits }`; `POST /api/crm/driver-visits/[taskId]` `{ answers, pos?, client_uuid? }` → `{ ok }`

- [ ] **Step 1: Write the failing tests**

`tests/crm-link-name.test.ts`

```ts
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
```

Append to `tests/proxy.test.ts`:

```ts
describe("CRM", () => {
  it("keeps drivers out of the CRM page and API, except their visits", () => {
    expect(proxy(req("/crm", "driver")).status).toBe(307);
    expect(proxy(req("/api/crm/businesses", "driver")).status).toBe(403);
    expect(proxy(req("/api/crm/driver-visits", "driver")).status).toBe(200);
  });
  it("lets a salesperson in", () => {
    expect(proxy(req("/crm", "salesperson")).status).toBe(200);
    expect(proxy(req("/api/crm/businesses", "salesperson")).status).toBe(200);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-link-name.test.ts tests/proxy.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`lib/crm/linkName.ts`

```ts
/** "…/maps/place/<name>/@…" → the name. Google encodes spaces as "+". */
export function placeNameFromUrl(url: string): string | null {
  const m = /\/maps\/place\/([^/@?]+)/.exec(url);
  if (!m) return null;
  try {
    const name = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    return name || null;
  } catch {
    return null;
  }
}
```

`lib/repo/crm/http.ts` — one place that turns `CrmError` into a response:

```ts
import { NextResponse } from "next/server";
import { CrmError } from "./write";

export function crmErrorResponse(e: unknown): NextResponse {
  if (e instanceof CrmError) return NextResponse.json({ ok: false, error: e.message, ...(e.extra ?? {}) }, { status: e.status });
  throw e;
}
export const idParam = (raw: string): number | null => (/^\d+$/.test(raw) ? Number(raw) : null);
export const CRM_ROLES = ["owner", "group_manager", "rep_manager", "salesperson", "platform_owner"] as const;
```

`app/api/crm/businesses/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { CRM_VIEWS, listBusinesses, viewCounts, type CrmView } from "@/lib/repo/crm/businesses";
import { createLead } from "@/lib/repo/crm/write";
import { CRM_ROLES, crmErrorResponse } from "@/lib/repo/crm/http";
import { isOneOf } from "@/lib/crm/vocab";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const view: CrmView = isOneOf(CRM_VIEWS, sp.get("view")) ? (sp.get("view") as CrmView) : "today";
  const { rows, nextOffset } = listBusinesses(guard.session, { view, q: sp.get("q") ?? undefined, offset: Number(sp.get("offset") ?? 0) || 0 });
  return NextResponse.json({ ok: true, rows, counts: viewCounts(guard.session), next_offset: nextOffset });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { answers?: unknown; client_uuid?: string } | null;
  try {
    const r = createLead(guard.session, { answers: (b?.answers ?? []) as never, clientUuid: b?.client_uuid ?? null });
    return NextResponse.json({ ok: true, id: r.id, next_task_id: r.nextTaskId }, { status: 201 });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
```

`app/api/crm/businesses/dedupe/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { findDuplicates } from "@/lib/repo/crm/dedupe";
import { CRM_ROLES } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const num = (k: string) => (sp.get(k) !== null && Number.isFinite(Number(sp.get(k))) ? Number(sp.get(k)) : null);
  return NextResponse.json({ ok: true, matches: findDuplicates(guard.session, { phone: sp.get("phone"), name: sp.get("name"), lat: num("lat"), lng: num("lng") }) });
}
```

`app/api/crm/businesses/[id]/context/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { flowContextFor } from "@/lib/repo/crm/businesses";
import { CRM_ROLES, idParam } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/context">) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const entry = req.nextUrl.searchParams.get("entry") === "talked_now" ? "talked_now" : "call";
  const r = id === null ? null : flowContextFor(guard.session, id, entry);
  if (!r) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, business: r.business, ctx: r.ctx });
}
```

`app/api/crm/businesses/[id]/flow/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { applyFlow } from "@/lib/repo/crm/write";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/flow">) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { answers?: unknown; entry?: string; task_id?: number; client_uuid?: string } | null;
  const entry = b?.entry === "talked_now" ? "talked_now" : "call";
  try {
    const r = applyFlow(guard.session, {
      customerId: id, answers: (b?.answers ?? []) as never, entry, channel: entry === "talked_now" ? "visit" : "call",
      taskId: typeof b?.task_id === "number" ? b.task_id : null, clientUuid: b?.client_uuid ?? null,
    });
    return NextResponse.json({ ok: true, activity_id: r.activityId, next_task_id: r.nextTaskId });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
```

`app/api/crm/businesses/[id]/claim/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { claimBusiness } from "@/lib/repo/crm/write";
import { crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/claim">) {
  const guard = requireRole(req, ["salesperson"]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  try {
    claimBusiness(guard.session, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
```

`app/api/crm/add-lead/context/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { addLeadContext } from "@/lib/repo/crm/businesses";
import { CRM_ROLES } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, ctx: addLeadContext(guard.session) });
}
```

`app/api/crm/resolve-link/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { resolveMapsLink } from "@/lib/resolveMapsLink";
import { placeNameFromUrl } from "@/lib/crm/linkName";
import { CRM_ROLES } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { url?: string } | null;
  const url = b?.url?.trim() ?? "";
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ ok: false, error: "لینک معتبر نیست" }, { status: 400 });
  const r = await resolveMapsLink(url, "");
  return NextResponse.json({
    ok: true,
    link: { name: placeNameFromUrl(r.resolvedUrl) ?? placeNameFromUrl(url), lat: r.lat, lng: r.lng, address: r.address, maps_url: url },
  });
}
```

`app/api/crm/reassign-request/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { requestReassign } from "@/lib/repo/crm/write";
import { CRM_ROLES, crmErrorResponse } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { phone?: string } | null;
  try {
    requestReassign(guard.session, b?.phone ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
```

`app/api/crm/driver-visits/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { driverVisitsFor } from "@/lib/repo/crm/driverVisits";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["driver"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, visits: driverVisitsFor(guard.session) });
}
```

`app/api/crm/driver-visits/[taskId]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { applyDriverVisit } from "@/lib/repo/crm/driverVisits";
import { crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crm/driver-visits/[taskId]">) {
  const guard = requireRole(req, ["driver"]);
  if (!guard.ok) return guard.response;
  const taskId = idParam((await ctx.params).taskId);
  if (taskId === null) return NextResponse.json({ ok: false, error: "بازدید پیدا نشد" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { answers?: unknown; pos?: { lat: number; lng: number; accuracy: number }; client_uuid?: string } | null;
  try {
    applyDriverVisit(guard.session, taskId, { answers: (b?.answers ?? []) as never, pos: b?.pos ?? null, clientUuid: b?.client_uuid ?? null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
```

`proxy.ts` — after the `isCheques` block:

```ts
  // The CRM is every role's but the driver's. A driver reaches exactly one CRM surface:
  // the verification visits on their round. The routes re-check.
  const isCrm = pathname === "/crm" || pathname.startsWith("/crm/") || pathname.startsWith("/api/crm");
  const isDriverVisits = pathname.startsWith("/api/crm/driver-visits");
  if (isCrm && !isDriverVisits && claims.role === "driver") return deny("/driver");
  if (isDriverVisits && claims.role !== "driver") return deny("/sales");
```

and in the existing `isDriverBriefing` list further down (the driver's allow-list, ~line 167), add one line so the final `claims.role === "driver" && !isDriver && …` rule does not bounce it:

```ts
    // CRM: a driver's verification visits on their round (lib/repo/crm/driverVisits.ts).
    pathname.startsWith("/api/crm/driver-visits") ||
```

- [ ] **Step 4:** `npx vitest run tests/crm-link-name.test.ts tests/proxy.test.ts tests/repo-boundary.test.ts` → PASS; `npx tsc --noEmit` → no errors in the new files. (`RouteContext<…>` is the typed-routes helper Next generates; the existing `app/api/locations/[id]/convert/route.ts` uses the same form. If `tsc` cannot find the route type, run `npx next typegen` once, as that route file relies on it.)
- [ ] **Step 5:** `git add app/api/crm lib/crm/linkName.ts lib/repo/crm/http.ts proxy.ts tests/crm-link-name.test.ts tests/proxy.test.ts && git commit -m "feat(crm): API routes; proxy keeps drivers to their visits"`

---

## Task 13: Task labels, the 5-second undo, the phone icon

**Files:**
- Modify: `lib/tasks/labels.ts`, `lib/offline/constants.ts`, `components/meridian/icon-map.ts`
- Test: existing `tests/no-raw-enum-copy.test.ts`, `tests/offline-outbox.test.ts`, `tests/countdown.test.ts`; new assertion in `tests/crm-vocab.test.ts`

- [ ] **Step 1: Failing test** — in `tests/crm-vocab.test.ts`, add the four imports to the import block at the top of the file and append the `describe`:

```ts
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
```

- [ ] **Step 2:** `npx vitest run tests/crm-vocab.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`lib/tasks/labels.ts` — extend the three maps:

```ts
export const TASK_KINDS = [
  "outreach", "call", "order", "visit", "reminder", "note", "admin", "delivery_retry", "sample_followup",
  "verify_visit", "sample_delivery", "quote_followup",
] as const;
// TASK_KIND_LABEL: add
  verify_visit: "بازدید تأیید",
  sample_delivery: "تحویل نمونه",
  quote_followup: "پیگیری قیمت",
// TASK_KIND_TONE: add
  verify_visit: "sage",
  sample_delivery: "sage",
  quote_followup: "accent",
// OUTCOME_LABEL: add
  NO_ANSWER: "جواب نداد",
  BUSY: "مشغول بود",
  UNAVAILABLE: "در دسترس نبود",
  WRONG_NUMBER: "شماره اشتباه",
  TALKED: "صحبت شد",
  CALL_BACK: "بعداً زنگ بزن",
  INTERESTED: "علاقه‌مند شد",
  ASKED_PRICE: "قیمت خواست",
  REQUESTED_SAMPLE: "نمونه خواست",
  NEGOTIATING: "مذاکره",
  READY_TO_ORDER: "آمادهٔ سفارش",
  GATEKEEPER: "تصمیم‌گیرنده نبود",
  VISIT_CLOSED: "بسته بود",
  INVALID: "نامعتبر",
```

`lib/offline/constants.ts`:

```ts
export const OUTBOX_HOLD_MS = 5000;
```

and in its doc comment add: `5 s, one undo window for the whole app (decided 2026-09-11, docs/tap-flow-principles.md §6.6).`

`components/meridian/icon-map.ts`: add `Phone` to the lucide import list and `phone: Phone,` to `ICONS` (next to `user`).

- [ ] **Step 4:** `npx vitest run tests/crm-vocab.test.ts tests/no-raw-enum-copy.test.ts tests/offline-outbox.test.ts tests/countdown.test.ts` → PASS. (`offline-outbox` advances its fake clock by 9000 ms, which is still past a 5000 ms hold; if any assertion expects a mutation to be *still held* after 5–9 s, change that literal to 4000.)
- [ ] **Step 5:** `git add lib/tasks/labels.ts lib/offline/constants.ts components/meridian/icon-map.ts tests/crm-vocab.test.ts && git commit -m "feat(crm): task kinds and outcome labels; one 5 s undo window; phone icon"`

---

## Task 14: `<TapFlow>` — the generic sheet, and `<FlowDone>`

**Files:**
- Create: `components/tapflow/TapFlow.tsx`, `components/tapflow/FlowDone.tsx`
- Modify: `app/globals.css` — append the `.meridian .tapflow` block right after the bottom-sheet section (`/* ---- 8 · bottom bento sheet …` block, which ends with `.meridian .ordline:last-child`)

**Interfaces:**
- Consumes: machine + types (T5), `resolveDue`/`labelDue` (T3), `nextOpenAt` (T3), `useSwipeDismiss(ref, "down", onDismiss, enabled)`, `JalaliDateInput({ value, onChange })` (ISO `YYYY-MM-DD`), `<Icon>`.
- Produces: `TapFlow(props: TapFlowProps)`, `CustomStepApi = { step, state, submit(optionId, value?) }`; `FlowDone({ chips, next, actions?, seconds?, onReturn })`.

The repo has no browser test harness (see Phase 4 handoff), so the component is kept thin over the tested machine; verification is `tsc`, lint and the manual pass in Task 21.

- [ ] **Step 1: CSS** — append to `app/globals.css`:

```css
/* ---- 8b · tap flows (docs/tap-flow-principles.md) — lives inside .sheet ---------- */
.meridian .tapflow { display: grid; gap: 12px; padding: 4px 20px 24px; }
.meridian .tapflow .tf-nav { display: flex; align-items: center; justify-content: space-between; min-height: 28px; }
.meridian .tapflow .tf-back { border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; padding: 4px 0; }
.meridian .tapflow .tf-steps { display: flex; gap: 4px; }
.meridian .tapflow .tf-steps i { width: 18px; height: 4px; border-radius: 999px; background: var(--line-2); }
.meridian .tapflow .tf-steps i.on { background: var(--accent); }
.meridian .tapflow .tf-q { margin: 0; font-size: 19px; font-weight: 700; line-height: 1.4; text-wrap: balance; }
.meridian .tapflow .tf-sub { margin: -6px 0 0; font-size: 13px; color: var(--muted); }
.meridian .tapflow .tf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.meridian .tapflow .tf-grid.one { grid-template-columns: 1fr; }
.meridian .tapflow .tf-grid.three { grid-template-columns: repeat(3, 1fr); }
.meridian .tapflow .tf-group { margin-bottom: -4px; font-size: 12px; color: var(--muted); }
.meridian .tapflow .tf-opt {
  min-height: 54px; display: flex; flex-direction: column; justify-content: center; gap: 2px; text-align: start;
  padding: 12px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--card); color: var(--text);
  font: inherit; font-size: 15px; font-weight: 500; cursor: pointer;
  transition: border-color 160ms var(--ease), background 160ms var(--ease);
}
.meridian .tapflow .tf-grid.three .tf-opt { align-items: center; text-align: center; font-size: 14px; padding: 10px 6px; }
.meridian .tapflow .tf-opt small { font-size: 12px; font-weight: 400; color: var(--muted); }
.meridian .tapflow .tf-opt.rec { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
.meridian .tapflow .tf-opt.rec small { color: var(--accent); }
.meridian .tapflow .tf-opt.on { border-color: var(--accent); background: var(--accent-soft); }
.meridian .tapflow .tf-opt.bad { color: var(--crit); }
.meridian .tapflow .tf-opt:disabled { opacity: .45; cursor: not-allowed; }
.meridian .tapflow button:focus-visible, .meridian .tapflow input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.meridian .tapflow .tf-input {
  width: 100%; padding: 13px 14px; border-radius: var(--r-md); border: 1px solid var(--line);
  background: var(--card-2); color: var(--text); font: inherit; font-size: 16px;
}
.meridian .tapflow .tf-input.ltr { direction: ltr; text-align: right; font-variant-numeric: tabular-nums; }
.meridian .tapflow .tf-go {
  width: 100%; padding: 14px; border: 0; border-radius: var(--r-md); background: var(--accent); color: var(--accent-ink);
  font: inherit; font-size: 16px; font-weight: 700; cursor: pointer;
}
.meridian .tapflow .tf-go:disabled { opacity: .4; cursor: not-allowed; }
.meridian .tapflow .tf-skip { border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; padding: 6px; justify-self: center; }
.meridian .tapflow .tf-card { display: grid; gap: 8px; padding: 12px; border-radius: var(--r-md); font-size: 13.5px; }
.meridian .tapflow .tf-card.block { background: var(--crit-soft); border: 1px solid color-mix(in srgb, var(--crit) 40%, transparent); }
.meridian .tapflow .tf-card.warn { background: var(--warn-soft); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.meridian .tapflow .tf-card.ok { color: var(--good); font-size: 12.5px; padding: 0; }
.meridian .tapflow .tf-card .acts { display: flex; flex-wrap: wrap; gap: 6px; }
.meridian .tapflow .tf-done { display: grid; justify-items: center; gap: 12px; padding: 18px 0 8px; text-align: center; }
.meridian .tapflow .tf-tick { display: grid; place-items: center; width: 60px; height: 60px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.meridian .tapflow .tf-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.meridian .tapflow .tf-chips span { padding: 4px 10px; border-radius: 999px; background: var(--sunk); font-size: 12px; }
.meridian .tapflow .tf-chips span.nx { background: var(--accent-soft); color: var(--accent); }
.meridian .tapflow .tf-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
@media (prefers-reduced-motion: reduce) { .meridian .tapflow .tf-opt { transition: none; } }
```

- [ ] **Step 2: Implement** — `components/tapflow/TapFlow.tsx`

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { useSwipeDismiss } from "@/components/useSwipeDismiss";
import { answerStep, backStep, SKIP, viewStep } from "@/lib/crm/flows/machine";
import type { FlowConfig, FlowContext, FlowState, ResolvedOption, ResolvedStep } from "@/lib/crm/flows/types";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { nextOpenAt, type WorkingHours } from "@/lib/crm/hours";

export interface CustomStepApi { step: ResolvedStep; state: FlowState; submit: (optionId: string, value?: string) => void }

export interface TapFlowProps {
  open: boolean;
  title: string;
  subtitle?: string;
  config: FlowConfig;
  ctx: FlowContext;
  state: FlowState;
  onState: (s: FlowState) => void;
  onSaved: (s: FlowState) => void;
  onClose: () => void;
  /** Renders the basics / link / pin / hours steps; each calls submit(optionId, value). */
  renderCustom?: (api: CustomStepApi) => ReactNode;
  /** Shown in place of the question once the flow has saved. */
  done?: ReactNode;
  /** Known working hours: time answers show the moved time when it changes. */
  hours?: WorkingHours;
}

const CUSTOM = new Set(["basics", "link", "pin", "hours"]);

/** One question per screen, in the meridian bottom sheet (docs/tap-flow-principles.md).
 *  Controlled: the host owns FlowState, which is what lets undo reopen the last question. */
export default function TapFlow(p: TapFlowProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const { open, onClose } = p;
  useSwipeDismiss(sheet, "down", onClose, open);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  const view = p.state.saved ? null : viewStep(p.config, p.ctx, p.state);
  const submit = (optionId: string, value?: string) => {
    const next = answerStep(p.config, p.ctx, p.state, optionId, value);
    p.onState(next);
    if (next.saved) p.onSaved(next);
  };

  return (
    <>
      <div className={`meridian-scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden />
      <div ref={sheet} className={`sheet${open ? " on" : ""}`} role="dialog" aria-modal="true" aria-labelledby="tf-title" aria-hidden={!open}>
        <div className="grab" />
        <div className="sheethead">
          <div>
            <h2 id="tf-title">{p.title}</h2>
            {p.subtitle ? <div className="s">{p.subtitle}</div> : null}
          </div>
          <button className="x" type="button" aria-label="بستن" onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className="tapflow" aria-live="polite">
          {p.state.saved
            ? p.done
            : view && (
                <>
                  <div className="tf-nav">
                    {p.state.answers.length > 0 ? (
                      <button type="button" className="tf-back" onClick={() => p.onState(backStep(p.config, p.ctx, p.state))}>‹ قبلی</button>
                    ) : <span />}
                    <div className="tf-steps" aria-hidden>
                      {Array.from({ length: 6 }, (_, i) => <i key={i} className={i < Math.min(p.state.stack.length, 6) ? "on" : ""} />)}
                    </div>
                  </div>
                  <p className="tf-q">{view.q}</p>
                  {view.sub ? <p className="tf-sub">{view.sub}</p> : null}
                  {CUSTOM.has(view.kind)
                    ? p.renderCustom?.({ step: view, state: p.state, submit })
                    : <StepBody key={`${view.id}-${p.state.answers.length}`} view={view} submit={submit} hours={p.hours} />}
                  {view.timeStep ? <button type="button" className="tf-skip" onClick={() => submit(SKIP)}>بدون کار بعدی…</button> : null}
                </>
              )}
        </div>
      </div>
    </>
  );
}

function StepBody({ view, submit, hours }: { view: ResolvedStep; submit: (id: string, value?: string) => void; hours?: WorkingHours }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const now = new Date().toISOString();

  if (pickFor) {
    return (
      <div className="tf-grid one">
        <JalaliDateInput value={date} onChange={setDate} aria-label="روز" />
        <button type="button" className="tf-go" disabled={!date} onClick={() => submit(pickFor, date)}>همین روز</button>
        <button type="button" className="tf-skip" onClick={() => setPickFor(null)}>برگشت</button>
      </div>
    );
  }

  const needsText = view.kind === "input" && !!view.input && !view.input.optional && !text.trim();
  const subFor = (o: ResolvedOption): string | undefined => {
    if (!o.due || o.due.kind === "pick" || o.due.kind === "none" || !hours?.length) return o.sub;
    const raw = resolveDue(o.due, now);
    if (!raw) return o.sub;
    const moved = nextOpenAt(hours, raw);
    return moved === raw ? o.sub : `ساعت باز شدن: ${labelDue(moved, now)}`;
  };
  const tap = (o: ResolvedOption) => {
    if (o.due?.kind === "pick") { setPickFor(o.id); return; }
    const value = view.kind === "multi" ? picked.join(",") : view.input ? text.trim() : "";
    submit(o.id, value || undefined);
  };
  const button = (o: ResolvedOption) => {
    const sub = subFor(o);
    return (
      <button key={o.id} type="button" className={`tf-opt ${o.tone ?? ""}`} disabled={needsText} onClick={() => tap(o)}>
        {o.label}
        {sub ? <small>{sub}</small> : null}
      </button>
    );
  };

  const groups: { label: string | null; items: ResolvedOption[] }[] = [];
  for (const o of view.options) {
    const label = o.group ?? null;
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(o);
    else groups.push({ label, items: [o] });
  }

  return (
    <>
      {view.input ? (
        <input
          className={`tf-input${view.input.ltr ? " ltr" : ""}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={view.input.placeholder}
          inputMode={view.input.ltr ? "tel" : undefined}
          autoFocus={!view.input.optional}
          aria-label={view.input.placeholder}
        />
      ) : null}
      {view.kind === "multi" ? (
        <div className="tf-grid one">
          {view.choices.map((c) => (
            <button key={c.id} type="button" aria-pressed={picked.includes(c.id)} className={`tf-opt${picked.includes(c.id) ? " on" : ""}`}
              onClick={() => setPicked((xs) => (xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id]))}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.label ?? "_"} style={{ display: "grid", gap: 8 }}>
          {g.label ? <div className="tf-group">{g.label}</div> : null}
          <div className={`tf-grid${g.items.length > 8 ? " three" : g.items.length === 1 ? " one" : ""}`}>{g.items.map(button)}</div>
        </div>
      ))}
    </>
  );
}
```

`components/tapflow/FlowDone.tsx`

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faDigits } from "@/lib/crm/vocab";

/** The done screen: what was saved, the likeliest next moves, and a return after `seconds`. */
export default function FlowDone({ chips, next, actions, seconds = 5, onReturn }: {
  chips: string[]; next?: string | null; actions?: ReactNode; seconds?: number; onReturn: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const ret = useRef(onReturn);
  const fired = useRef(false);
  useEffect(() => { ret.current = onReturn; });
  useEffect(() => {
    const t = window.setInterval(() => setLeft((l) => l - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const go = () => { if (!fired.current) { fired.current = true; ret.current(); } };
  useEffect(() => { if (left <= 0) go(); });

  return (
    <div className="tf-done">
      <div className="tf-tick"><Icon name="check" /></div>
      <p className="tf-q">ثبت شد</p>
      <div className="tf-chips">
        {chips.map((c) => <span key={c}>{c}</span>)}
        {next ? <span className="nx">{next}</span> : null}
      </div>
      {actions ? <div className="tf-acts">{actions}</div> : null}
      <p className="tf-sub">برگشت به فهرست در {faDigits(String(Math.max(left, 0)))}…</p>
      <button type="button" className="tf-skip" onClick={go}>همین حالا برگرد</button>
    </div>
  );
}
```

- [ ] **Step 3:** `npx tsc --noEmit && npm run lint -- components/tapflow` → clean. (If lint flags `react-hooks/exhaustive-deps` on the `left` effect, give it `[left]` and keep `go` inside it.)
- [ ] **Step 4:** `git add components/tapflow app/globals.css && git commit -m "feat(crm): TapFlow sheet and done screen in the meridian theme"`

---

## Task 15: Held saves and call return

**Files:**
- Create: `components/crm/useHeldSave.ts`, `components/crm/useCallReturn.ts`, `lib/crm/share.ts`
- Test: `tests/crm-share.test.ts`

**Interfaces:**
- Consumes: `OUTBOX_HOLD_MS` (T13), `telHref` (T1), `faToman` (`lib/format.ts`).
- Produces: `useHeldSave() → { hold(run), cancel(): boolean, flush(): Promise<void> }`; `useCallReturn(onReturn) → startCall(customerId, phoneNorm)`; `priceListText(products, chosenIds)`, `shareUrl(channel, phoneNorm, text)`.

- [ ] **Step 1: Write the failing test** — `tests/crm-share.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { priceListText, shareUrl } from "@/lib/crm/share";

const products = [{ id: 1, name: "کره ۱۰ گرمی", price_toman: 185000 }, { id: 2, name: "پودر کاکائو", price_toman: null }];

describe("share", () => {
  it("lists the chosen products with prices, all when none chosen", () => {
    expect(priceListText(products, ["1"])).toBe("لیست قیمت امروز:\n• کره ۱۰ گرمی — ۱۸۵٬۰۰۰ تومان");
    expect(priceListText(products, [])).toContain("• پودر کاکائو — استعلام");
  });
  it("builds WhatsApp and Telegram links", () => {
    expect(shareUrl("whatsapp", "9120001234", "سلام")).toBe("https://wa.me/989120001234?text=%D8%B3%D9%84%D8%A7%D9%85");
    expect(shareUrl("whatsapp", null, "سلام")).toBe("https://wa.me/?text=%D8%B3%D9%84%D8%A7%D9%85");
    expect(shareUrl("telegram", "9120001234", "سلام")).toBe("https://t.me/share/url?url=%20&text=%D8%B3%D9%84%D8%A7%D9%85");
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-share.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `lib/crm/share.ts`

```ts
import { faToman } from "@/lib/format";

export function priceListText(products: { id: number; name: string; price_toman: number | null }[], chosenIds: string[]): string {
  const list = chosenIds.length ? products.filter((p) => chosenIds.includes(String(p.id))) : products;
  const lines = list.map((p) => `• ${p.name} — ${p.price_toman === null ? "استعلام" : faToman(p.price_toman)}`);
  return ["لیست قیمت امروز:", ...lines].join("\n");
}

export function shareUrl(channel: "whatsapp" | "telegram", phoneNorm: string | null, text: string): string {
  const t = encodeURIComponent(text);
  if (channel === "whatsapp") return `https://wa.me/${phoneNorm ? `98${phoneNorm}` : ""}?text=${t}`;
  return `https://t.me/share/url?url=%20&text=${t}`;
}
```

(`faToman(185000)` renders `۱۸۵٬۰۰۰ تومان` with the fa-IR grouping separator `٬`; if the test's expected string differs by separator, copy the separator `faToman` actually produces — `lib/format.ts` is the source of truth.)

`components/crm/useHeldSave.ts`

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";
import { OUTBOX_HOLD_MS } from "@/lib/offline/constants";

/** The 5-second undo: a finished flow's POST is held client-side, so undo never has to
 *  reverse a server write. Leaving the page (a tel: call, a tab switch, closing) sends it
 *  at once -- a held save is never lost. One held save at a time; a new hold sends the old. */
export function useHeldSave() {
  const pending = useRef<{ timer: number; run: () => Promise<void> } | null>(null);

  const flush = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.clearTimeout(p.timer);
    await p.run();
  }, []);

  const hold = useCallback((run: () => Promise<void>) => {
    void flush();
    const timer = window.setTimeout(() => {
      const p = pending.current;
      pending.current = null;
      if (p) void p.run();
    }, OUTBOX_HOLD_MS);
    pending.current = { timer, run };
  }, [flush]);

  const cancel = useCallback((): boolean => {
    const p = pending.current;
    if (!p) return false;
    window.clearTimeout(p.timer);
    pending.current = null;
    return true;
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  return { hold, cancel, flush };
}
```

`components/crm/useCallReturn.ts`

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";
import { telHref } from "@/lib/crm/phone";

/** Tap Call → the dialler opens → when the rep comes back, `onReturn(id)` opens the
 *  after-call flow. On a desktop the page never hides, so it opens after 1.5 s instead. */
export function useCallReturn(onReturn: (customerId: number) => void) {
  const pending = useRef<number | null>(null);
  const cb = useRef(onReturn);
  useEffect(() => { cb.current = onReturn; });

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && pending.current !== null) {
        const id = pending.current;
        pending.current = null;
        cb.current(id);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return useCallback((customerId: number, phoneNorm: string) => {
    pending.current = customerId;
    window.location.href = telHref(phoneNorm);
    window.setTimeout(() => {
      if (pending.current === customerId && document.visibilityState === "visible") {
        pending.current = null;
        cb.current(customerId);
      }
    }, 1500);
  }, []);
}
```

- [ ] **Step 4:** `npx vitest run tests/crm-share.test.ts && npx tsc --noEmit` → PASS / clean.
- [ ] **Step 5:** `git add lib/crm/share.ts components/crm/useHeldSave.ts components/crm/useCallReturn.ts tests/crm-share.test.ts && git commit -m "feat(crm): held saves for the 5 s undo, call-return hook, price-list sharing"`

---

## Task 16: The pin step and the after-call flow component

**Files:**
- Create: `components/crm/PinStep.tsx`, `components/crm/AfterCallFlow.tsx`, `components/crm/flowHost.ts`

**Interfaces:**
- Consumes: `TapFlow`, `CustomStepApi`, `FlowDone` (T14); `useHeldSave` (T15); `priceListText`, `shareUrl` (T15); `afterCallFlow` (T6); machine (T5); `useToast()(message, variant, { label, onClick })`; `LocationPinPicker({ initial, onConfirm(lat,lng), onCancel })` (has its own «اینجا هستم» and «ثبت موقعیت» buttons); `useMyPosition()` (provider is mounted in `app/layout.tsx`).
- Produces:
  - `FlowHostProps = { open: boolean; onHide(): void; onReopen(): void; onFinished(customerId: number): void }` — the contract every flow host (board, Pocket, Today, driver panel) uses. The component **stays mounted while hidden** so a held save and its undo survive the sheet closing; the host unmounts it on `onFinished`.
  - `PinStep({ api, initial, allowApprox })`
  - `AfterCallFlow(props: FlowHostProps & { customerId; taskId?; entry?; onRedial?(customerId, phoneNorm); onSpawnLead?(phoneNorm | null) })`

- [ ] **Step 1: Implement** — `components/crm/flowHost.ts`

```ts
/** How a page hosts a flow sheet.
 *  onHide: the sheet slides away (done countdown, ✕, swipe) -- the component stays mounted,
 *          so a held save still sends and its undo can still reopen the sheet.
 *  onReopen: undo, or tapping the same business again while a draft is open.
 *  onFinished: the save reached the server -- unmount, refresh, highlight. */
export interface FlowHostProps {
  open: boolean;
  onHide: () => void;
  onReopen: () => void;
  onFinished: (customerId: number) => void;
}
```

`components/crm/PinStep.tsx`

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";

const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });

/** A pin step: the picker's own «اینجا هستم» / «ثبت موقعیت» do the work. The first option
 *  confirms with the pin; any other option (e.g. «نه، بعداً روی نقشه») submits without one. */
export default function PinStep({ api, initial, allowApprox }: {
  api: CustomStepApi; initial: { lat: number; lng: number } | null; allowApprox: boolean;
}) {
  const [approx, setApprox] = useState(false);
  const [confirm, ...others] = api.step.options;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <LocationPinPicker
        initial={initial}
        onConfirm={(lat, lng) => api.submit(confirm.id, JSON.stringify({ lat, lng, precision: approx ? "approx" : "exact" }))}
        onCancel={() => (others[0] ? api.submit(others[0].id) : undefined)}
      />
      {allowApprox ? (
        <button type="button" aria-pressed={approx} className={`tf-opt${approx ? " on" : ""}`} onClick={() => setApprox((a) => !a)}>
          آدرس تقریبی است
          <small>مثلاً از روی منوی اسنپ‌فود — راننده دقیقش می‌کند</small>
        </button>
      ) : null}
      {others.map((o) => (
        <button key={o.id} type="button" className="tf-skip" onClick={() => api.submit(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}
```

`components/crm/AfterCallFlow.tsx`

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useToast } from "@/components/ToastProvider";
import { useHeldSave } from "./useHeldSave";
import PinStep from "./PinStep";
import type { FlowHostProps } from "./flowHost";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { backStep, interpolate, startFlow } from "@/lib/crm/flows/machine";
import type { FlowContext, FlowState } from "@/lib/crm/flows/types";
import type { BusinessRow } from "@/lib/repo/crm/businesses";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { nextOpenAt, parseHours } from "@/lib/crm/hours";
import { OUTCOMES } from "@/lib/crm/outcomes";
import { normPhone } from "@/lib/crm/phone";
import { priceListText, shareUrl } from "@/lib/crm/share";
import { CONTACT_ROLE_LABEL, TEMPERATURE_LABEL, VERIFICATION_LABEL } from "@/lib/crm/vocab";
import { outcomeLabel } from "@/lib/tasks/labels";

/** "تماس دوباره · فردا ۱۲:۰۰" -- the next action as the server will save it. */
function nextLabelFor(data: { business: BusinessRow; ctx: FlowContext }, st: FlowState): string | null {
  const acc = st.acc;
  if (acc.invalid) return "از همهٔ فهرست‌ها بیرون رفت";
  if (!acc.due || acc.due.kind === "none") return "بدون کار بعدی";
  const now = new Date().toISOString();
  const picked = [...st.answers].reverse().find((a) => a.value && /^\d{4}-\d{2}-\d{2}$/.test(a.value))?.value ?? null;
  const raw = resolveDue(acc.due, now, picked);
  if (!raw) return null;
  return `${interpolate(acc.next_title ?? "پیگیری", data.ctx, acc)} · ${labelDue(nextOpenAt(parseHours(data.business.working_hours_json), raw), now)}`;
}

export default function AfterCallFlow({
  customerId, taskId = null, entry = "call", open, onHide, onReopen, onFinished, onRedial, onSpawnLead,
}: FlowHostProps & {
  customerId: number;
  taskId?: number | null;
  entry?: "call" | "talked_now";
  onRedial?: (customerId: number, phoneNorm: string) => void;
  onSpawnLead?: (phoneNorm: string | null) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const { hold, cancel, flush } = useHeldSave();
  const [data, setData] = useState<{ business: BusinessRow; ctx: FlowContext } | null>(null);
  const [state, setState] = useState<FlowState | null>(null);

  // The latest toast/onHide, without re-running the load whenever a parent re-renders.
  const toastRef = useRef(toast);
  const hideRef = useRef(onHide);
  useEffect(() => { toastRef.current = toast; hideRef.current = onHide; });

  useEffect(() => {
    let alive = true;
    fetch(`/api/crm/businesses/${customerId}/context?entry=${entry}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; business?: BusinessRow; ctx?: FlowContext; error?: string }) => {
        if (!alive) return;
        if (j.ok && j.business && j.ctx) {
          setData({ business: j.business, ctx: j.ctx });
          setState(startFlow(afterCallFlow, j.ctx));
        } else {
          toastRef.current(j.error ?? "این کسب‌وکار خوانده نشد", "error");
          hideRef.current();
        }
      })
      .catch(() => { if (alive) toastRef.current("اتصال برقرار نشد", "error"); });
    return () => { alive = false; };
  }, [customerId, entry]);

  const onSaved = useCallback((st: FlowState) => {
    if (!data) return;
    const acc = st.acc;
    // Opened inside the tap, so the browser treats it as the user's own navigation.
    if (acc.share) {
      const ids = (st.values.prods ?? "").split(",").filter(Boolean);
      window.open(shareUrl(acc.share, data.business.phone_norm, priceListText(data.ctx.products, ids)), "_blank", "noopener");
    }
    const clientUuid = crypto.randomUUID();
    hold(async () => {
      const res = await fetch(`/api/crm/businesses/${customerId}/flow`, {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: st.answers, entry, task_id: taskId, client_uuid: clientUuid }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { toast(j.error ?? "ذخیره نشد؛ دوباره امتحان کنید", "error"); return; }
      onFinished(customerId);
    });
    toast(`ثبت شد · ${nextLabelFor(data, st) ?? ""}`, "success", {
      label: "لغو",
      onClick: () => {
        if (cancel()) { setState(backStep(afterCallFlow, data.ctx, st)); onReopen(); }
      },
    });
    const newPhone = normPhone(st.values.new_phone);
    if (acc.redial && newPhone) onRedial?.(customerId, newPhone);
  }, [data, customerId, entry, taskId, hold, cancel, toast, onFinished, onReopen, onRedial]);

  if (!data || !state) return null;
  const acc = state.acc;
  const o = acc.outcome ? OUTCOMES[acc.outcome] : null;
  const chips = [
    acc.outcome ? outcomeLabel(acc.outcome) : null,
    acc.verification ? VERIFICATION_LABEL[acc.verification] : null,
    acc.contact_role ? CONTACT_ROLE_LABEL[acc.contact_role] : null,
    o?.signal ? `دما: ${TEMPERATURE_LABEL[o.signal]}` : null,
  ].filter((x): x is string => !!x);
  const actions = acc.open_order ? (
    <button type="button" className="btn solid" onClick={async () => { await flush(); router.push(`/sales/orders?customer=${customerId}`); }}>ثبت سفارش</button>
  ) : acc.spawn_lead ? (
    <button type="button" className="btn solid" onClick={async () => { await flush(); onSpawnLead?.(data.business.phone_norm); }}>افزودن سرنخ با این شماره</button>
  ) : undefined;

  return (
    <TapFlow
      open={open}
      title={data.business.business_name}
      subtitle={[data.business.area_label, data.ctx.vars.contact].filter(Boolean).join(" · ")}
      config={afterCallFlow}
      ctx={data.ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onHide}
      hours={parseHours(data.business.working_hours_json)}
      renderCustom={(api: CustomStepApi) =>
        api.step.kind === "pin" ? (
          <PinStep api={api} allowApprox={false}
            initial={data.business.lat !== null && data.business.lng !== null ? { lat: data.business.lat, lng: data.business.lng } : null} />
        ) : null}
      done={<FlowDone key={state.answers.length} chips={chips} next={nextLabelFor(data, state)} actions={actions} onReturn={onHide} />}
    />
  );
}
```

- [ ] **Step 2:** `npx tsc --noEmit && npm run lint -- components/crm` → clean, with **no** `eslint-disable` comments (the repo removed all 33 of them on 2026-09-10; fix the shape instead — refs for callbacks a load effect must not re-run on, pure top-level helpers for derived labels).
- [ ] **Step 3:** `git add components/crm/flowHost.ts components/crm/PinStep.tsx components/crm/AfterCallFlow.tsx && git commit -m "feat(crm): after-call flow component with autosave, undo and sharing"`

---

## Task 17: Add Lead — link, basics, hours picker and the flow component

**Files:**
- Create: `components/crm/LinkStep.tsx`, `components/crm/BasicsStep.tsx`, `components/crm/HoursPicker.tsx`, `components/crm/AddLeadFlow.tsx`

**Interfaces:**
- Consumes: T14–T16; `addLeadFlow`, `basicsOf`, `linkOf`, `pinOf`, `hoursOf`, `hasPhone` (T6); `DupMatch` (T9); `formatHours`, `WEEKDAY_LABEL`, `HoursRange` (T3); `/api/crm/resolve-link`, `/api/crm/businesses/dedupe`, `/api/crm/reassign-request`, `/api/crm/add-lead/context`, `POST /api/crm/businesses` (T12).
- Produces: `AddLeadFlow(props: FlowHostProps & { prefillPhone?: string | null; onOpenExisting(id); onCallNow(id, phoneNorm); onOpenBusiness(id); onTalkedNow(id) })`.

- [ ] **Step 1: Implement** — `components/crm/LinkStep.tsx`

```tsx
"use client";

import { useState } from "react";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";

/** Paste a Google Maps / SnappFood / Instagram link; the server resolves name, pin and address. */
export default function LinkStep({ api }: { api: CustomStepApi }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (u: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/crm/resolve-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) });
      const j = (await res.json()) as { ok: boolean; link?: unknown; error?: string };
      if (!j.ok) { setErr(j.error ?? "لینک خوانده نشد"); return; }
      api.submit("ok", JSON.stringify(j.link));
    } catch {
      setErr("اتصال برقرار نشد");
    } finally {
      setBusy(false);
    }
  };
  const paste = async () => {
    try {
      const m = /https?:\/\/\S+/.exec(await navigator.clipboard.readText());
      if (!m) { setErr("در کلیپ‌بورد لینکی نیست"); return; }
      setUrl(m[0]);
      void resolve(m[0]);
    } catch {
      setErr("اجازهٔ خواندن کلیپ‌بورد داده نشد؛ لینک را در کادر بچسبانید");
    }
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <input className="tf-input ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://maps.app.goo.gl/…" aria-label="لینک" inputMode="url" />
        <button type="button" className="btn ghost" onClick={() => void paste()}>چسباندن</button>
      </div>
      {err ? <div className="tf-card warn">{err}</div> : null}
      <button type="button" className="tf-go" disabled={!url.trim() || busy} onClick={() => void resolve(url.trim())}>{busy ? "در حال خواندن…" : "ادامه"}</button>
      <button type="button" className="tf-skip" onClick={() => api.submit("nolink")}>لینک ندارم</button>
    </>
  );
}
```

`components/crm/BasicsStep.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";
import { useToast } from "@/components/ToastProvider";
import { basicsOf, linkOf, pinOf } from "@/lib/crm/flows/addLead";
import { FOOD_APP_SOURCES, faDigits } from "@/lib/crm/vocab";
import type { DupMatch } from "@/lib/repo/crm/dedupe";

/** Name + phone, with the duplicate check running as the rep types (spec D7). */
export default function BasicsStep({ api, prefillPhone, onOpenExisting, onRequested }: {
  api: CustomStepApi; prefillPhone?: string | null; onOpenExisting: (id: number) => void; onRequested: () => void;
}) {
  const toast = useToast();
  const prior = basicsOf(api.state.values);
  const link = linkOf(api.state.values);
  const pin = pinOf(api.state.values);
  const lat = pin?.lat ?? null;
  const lng = pin?.lng ?? null;
  const [name, setName] = useState(prior?.name ?? link?.name ?? "");
  const [phone, setPhone] = useState(prior?.phone ?? prefillPhone ?? "");
  const [branchOf, setBranchOf] = useState<number | null>(prior?.branch_of ?? null);
  const [matches, setMatches] = useState<DupMatch[]>([]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const qs = new URLSearchParams();
      if (phone.trim()) qs.set("phone", phone.trim());
      if (name.trim()) qs.set("name", name.trim());
      if (lat !== null && lng !== null) { qs.set("lat", String(lat)); qs.set("lng", String(lng)); }
      if (!qs.has("phone") && !qs.has("name")) { setMatches([]); return; }
      const j = (await fetch(`/api/crm/businesses/dedupe?${qs}`).then((r) => r.json()).catch(() => null)) as { ok?: boolean; matches?: DupMatch[] } | null;
      if (j?.ok) setMatches(j.matches ?? []);
    }, 400);
    return () => window.clearTimeout(t);
  }, [name, phone, lat, lng]);

  const phoneHits = matches.filter((m) => m.kind === "phone");
  const nameHits = matches.filter((m) => m.kind === "name");
  const branchOk = branchOf !== null && phoneHits.some((m) => m.reachable && m.id === branchOf);
  const blocked = phoneHits.length > 0 && !branchOk;
  const request = async () => {
    const res = await fetch("/api/crm/reassign-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
    toast(res.ok ? "درخواست واگذاری برای مدیرتان فرستاده شد" : "درخواست فرستاده نشد", res.ok ? "success" : "error");
    if (res.ok) onRequested();
  };
  const foodApp = api.state.acc.source ? FOOD_APP_SOURCES.has(api.state.acc.source) : false;

  return (
    <>
      <input className="tf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کسب‌وکار" aria-label="نام کسب‌وکار" autoFocus={!name} />
      <input className="tf-input ltr" value={phone} onChange={(e) => { setPhone(e.target.value); setBranchOf(null); }} placeholder={foodApp ? "تلفن (اگر دارید)" : "0912 ___ ____"} aria-label="تلفن" inputMode="tel" />
      {phoneHits.map((m, i) =>
        m.reachable ? (
          branchOk && m.id === branchOf ? (
            <div key={i} className="tf-card ok">به‌عنوان شعبهٔ دیگرِ «{m.name}» ثبت می‌شود.</div>
          ) : (
            <div key={i} className="tf-card block">
              <b>این شماره مال «{m.name}» است</b>
              <span>{[m.area, m.owner_name && `مسئول: ${m.owner_name}`].filter(Boolean).join(" · ")}</span>
              <div className="acts">
                <button type="button" className="btn solid" onClick={() => onOpenExisting(m.id!)}>باز کردن همان</button>
                <button type="button" className="btn ghost" onClick={() => setBranchOf(m.id)}>شعبهٔ دیگری است</button>
                <button type="button" className="btn ghost" onClick={() => setPhone("")}>شماره را اصلاح کنم</button>
              </div>
            </div>
          )
        ) : (
          <div key={i} className="tf-card block">
            <b>این کسب‌وکار قبلاً ثبت شده</b>
            <span>{[m.owner_name && `مسئول: ${m.owner_name}`, m.area].filter(Boolean).join(" · ")}</span>
            <div className="acts">
              <button type="button" className="btn solid" onClick={() => void request()}>درخواست واگذاری</button>
              <button type="button" className="btn ghost" onClick={() => setPhone("")}>شماره را اصلاح کنم</button>
            </div>
          </div>
        )
      )}
      {nameHits.map((m, i) => (
        <div key={`n${i}`} className="tf-card warn">
          <b>نام مشابه: {m.name ?? "کسب‌وکار ثبت‌شده"}</b>
          <span>{m.distance_km !== null ? `${faDigits(String(Math.round(m.distance_km * 1000)))} متر دورتر · ` : ""}اگر همان نیست، ادامه دهید</span>
          {m.reachable && m.id ? <div className="acts"><button type="button" className="btn ghost" onClick={() => onOpenExisting(m.id!)}>باز کن</button></div> : null}
        </div>
      ))}
      <button type="button" className="tf-go" disabled={name.trim().length < 2 || blocked}
        onClick={() => api.submit("ok", JSON.stringify({ name: name.trim(), phone: phone.trim() || null, branch_of: branchOk ? branchOf : null }))}>
        ادامه
      </button>
    </>
  );
}
```

`components/crm/HoursPicker.tsx`

```tsx
"use client";

import { useState } from "react";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";
import { formatHours, WEEKDAY_LABEL, type HoursRange } from "@/lib/crm/hours";
import { faDigits } from "@/lib/crm/vocab";

const PRESETS: { label: string; days: number[] }[] = [
  { label: "همه‌روزه", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "شنبه تا چهارشنبه", days: [0, 1, 2, 3, 4] },
  { label: "به‌جز جمعه", days: [0, 1, 2, 3, 4, 5] },
];
const OPENS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19];
const closesAfter = (from: number): number[] => [...Array.from({ length: 24 - from }, (_, i) => from + 1 + i), 1, 2];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const hourLabel = (h: number, closing: boolean) => (closing && h <= 2 ? `${faDigits(String(h))} بامداد` : faDigits(String(h)));

type Phase = "days" | "custom" | "from" | "to" | "more";

/** Working hours, one tap per screen: which days → opens → closes → another range? →
 *  done. Several ranges per day (۱۲–۱۶ و ۱۹–۲۴) and past-midnight closing are both normal
 *  for restaurants. */
export default function HoursPicker({ api }: { api: CustomStepApi }) {
  const [phase, setPhase] = useState<Phase>("days");
  const [days, setDays] = useState<number[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [ranges, setRanges] = useState<HoursRange[]>([]);
  const label = (t: string) => <p className="tf-group" style={{ fontSize: 14 }}>{t}</p>;
  const chip = (key: string | number, text: string, on: boolean, onClick: () => void, cls = "") => (
    <button key={key} type="button" className={`tf-opt ${cls}${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>{text}</button>
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {ranges.length ? <div className="tf-card ok">{formatHours(ranges)}</div> : null}

      {phase === "days" && (
        <>
          {label(ranges.length ? "روزهای دیگر؟" : "کدام روزها باز است؟")}
          <div className="tf-grid">
            {PRESETS.map((p) => chip(p.label, p.label, false, () => { setDays(p.days); setPhase("from"); }))}
            {chip("custom", "روزهای خاص…", false, () => { setDays([]); setPhase("custom"); })}
          </div>
          {ranges.length === 0 ? <button type="button" className="tf-skip" onClick={() => api.submit("skip")}>نمی‌دانم</button> : null}
        </>
      )}

      {phase === "custom" && (
        <>
          {label("روزها را بزنید")}
          <div className="tf-grid three">
            {WEEKDAY_LABEL.map((d, i) => chip(i, d, days.includes(i), () => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))))}
          </div>
          <button type="button" className="tf-go" disabled={days.length === 0} onClick={() => setPhase("from")}>ادامه</button>
        </>
      )}

      {phase === "from" && (
        <>
          {label("از چه ساعتی؟")}
          <div className="tf-grid three">{OPENS.map((h) => chip(h, hourLabel(h, false), false, () => { setFrom(h); setPhase("to"); }))}</div>
        </>
      )}

      {phase === "to" && from !== null && (
        <>
          {label(`از ${faDigits(String(from))} تا چه ساعتی؟`)}
          <div className="tf-grid three">
            {closesAfter(from).map((h) => chip(h, hourLabel(h, true), false, () => {
              setRanges((rs) => [...rs, { days: [...days].sort((a, b) => a - b), from: hh(from), to: hh(h) }]);
              setPhase("more");
            }))}
          </div>
        </>
      )}

      {phase === "more" && (
        <>
          {label("بازهٔ دیگری هم دارد؟")}
          <div className="tf-grid">
            {chip("again", "بازهٔ دیگر در همین روزها", false, () => setPhase("from"))}
            {chip("other", "روزهای دیگر، ساعت دیگر", false, () => setPhase("days"))}
          </div>
          <button type="button" className="tf-go" onClick={() => api.submit("ok", JSON.stringify(ranges))}>تمام</button>
        </>
      )}
    </div>
  );
}
```

`components/crm/AddLeadFlow.tsx`

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useToast } from "@/components/ToastProvider";
import { useMyPosition } from "@/components/MyPositionProvider";
import { useHeldSave } from "./useHeldSave";
import PinStep from "./PinStep";
import LinkStep from "./LinkStep";
import BasicsStep from "./BasicsStep";
import HoursPicker from "./HoursPicker";
import type { FlowHostProps } from "./flowHost";
import { addLeadFlow, basicsOf, hasPhone, hoursOf, pinOf } from "@/lib/crm/flows/addLead";
import { backStep, interpolate, startFlow } from "@/lib/crm/flows/machine";
import type { FlowContext, FlowState } from "@/lib/crm/flows/types";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { formatHours, nextOpenAt } from "@/lib/crm/hours";
import { normPhone } from "@/lib/crm/phone";
import { BUSINESS_TYPE_LABEL, LEAD_SOURCE_LABEL, PRICE_TIER_LABEL, VERIFICATION_LABEL } from "@/lib/crm/vocab";

function nextLabelFor(ctx: FlowContext, st: FlowState): string | null {
  const acc = st.acc;
  if (!acc.due || acc.due.kind === "none") return null;
  const now = new Date().toISOString();
  const raw = resolveDue(acc.due, now);
  return raw ? `${interpolate(acc.next_title ?? "پیگیری", ctx, acc)} · ${labelDue(nextOpenAt(hoursOf(st.values), raw), now)}` : null;
}

export default function AddLeadFlow({
  open, onHide, onReopen, onFinished, prefillPhone, onOpenExisting, onCallNow, onOpenBusiness, onTalkedNow,
}: FlowHostProps & {
  prefillPhone?: string | null;
  onOpenExisting: (id: number) => void;
  onCallNow: (id: number, phoneNorm: string) => void;
  onOpenBusiness: (id: number) => void;
  onTalkedNow: (id: number) => void;
}) {
  const toast = useToast();
  const { position } = useMyPosition();
  const { hold, cancel, flush } = useHeldSave();
  const [ctx, setCtx] = useState<FlowContext | null>(null);
  const [state, setState] = useState<FlowState | null>(null);
  const created = useRef<number | null>(null);
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  useEffect(() => {
    let alive = true;
    fetch("/api/crm/add-lead/context")
      .then((r) => r.json())
      .then((j: { ok: boolean; ctx?: FlowContext }) => {
        if (alive && j.ok && j.ctx) { setCtx(j.ctx); setState(startFlow(addLeadFlow, j.ctx)); }
      })
      .catch(() => { if (alive) toastRef.current("اتصال برقرار نشد", "error"); });
    return () => { alive = false; };
  }, []);

  const post = useCallback(async (st: FlowState, clientUuid: string): Promise<number | null> => {
    const res = await fetch("/api/crm/businesses", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: st.answers, client_uuid: clientUuid }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: number; error?: string };
    if (!res.ok || !j.ok || !j.id) { toast(j.error ?? "سرنخ ذخیره نشد", "error"); return null; }
    created.current = j.id;
    return j.id;
  }, [toast]);

  const onSaved = useCallback((st: FlowState) => {
    if (!ctx) return;
    const uuid = crypto.randomUUID();
    // "I already talked to them": the after-call flow needs the id now, so no hold, no undo.
    if (st.acc.handoff === "talked_now") {
      void post(st, uuid).then((id) => { if (id) { onFinished(id); onTalkedNow(id); } });
      return;
    }
    hold(async () => { const id = await post(st, uuid); if (id) onFinished(id); });
    toast(`سرنخ «${basicsOf(st.values)?.name ?? ""}» ثبت شد`, "success", {
      label: "لغو",
      onClick: () => { if (cancel()) { setState(backStep(addLeadFlow, ctx, st)); onReopen(); } },
    });
  }, [ctx, post, hold, cancel, toast, onFinished, onTalkedNow, onReopen]);

  if (!ctx || !state) return null;
  const v = state.values;
  const acc = state.acc;
  const pin = pinOf(v);
  const phone = normPhone(basicsOf(v)?.phone);
  const chips = [
    basicsOf(v)?.name,
    acc.business_type ? BUSINESS_TYPE_LABEL[acc.business_type] : null,
    acc.source ? `منبع: ${LEAD_SOURCE_LABEL[acc.source]}` : null,
    acc.price_tier && acc.price_tier !== "unknown" ? `قیمت: ${PRICE_TIER_LABEL[acc.price_tier]}` : null,
    hoursOf(v).length ? formatHours(hoursOf(v)) : null,
    VERIFICATION_LABEL[acc.verification ?? "unverified"],
    pin?.precision === "approx" ? "مکان تقریبی" : null,
    hasPhone(v) ? null : "بدون تلفن",
  ].filter((x): x is string => !!x);
  const after = async (then: (id: number) => void) => { await flush(); if (created.current) then(created.current); };
  const actions = (
    <>
      {phone ? <button type="button" className="btn solid" onClick={() => void after((id) => onCallNow(id, phone))}>تماس همین حالا</button> : null}
      <button type="button" className="btn ghost" onClick={() => void after(onOpenBusiness)}>باز کردن پرونده</button>
    </>
  );
  const here = position ? { lat: position.lat, lng: position.lng } : null;

  const renderCustom = (api: CustomStepApi) => {
    switch (api.step.kind) {
      case "link": return <LinkStep api={api} />;
      case "basics": return <BasicsStep api={api} prefillPhone={prefillPhone} onOpenExisting={(id) => { onHide(); onOpenExisting(id); }} onRequested={onHide} />;
      case "hours": return <HoursPicker api={api} />;
      case "pin": return <PinStep api={api} allowApprox={api.step.id === "pin"} initial={pinOf(api.state.values) ?? (api.step.id === "here" || api.state.acc.pin_mode === "gps" ? here : null)} />;
      default: return null;
    }
  };

  return (
    <TapFlow
      open={open}
      title="سرنخ تازه"
      subtitle={basicsOf(v)?.name}
      config={addLeadFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onHide}
      hours={hoursOf(v)}
      renderCustom={renderCustom}
      done={<FlowDone key={state.answers.length} chips={chips} next={nextLabelFor(ctx, state)} actions={actions} onReturn={onHide} />}
    />
  );
}
```

- [ ] **Step 2:** `npx tsc --noEmit && npm run lint -- components/crm` → clean, no `eslint-disable`.
- [ ] **Step 3:** `git add components/crm && git commit -m "feat(crm): add-lead flow -- link, live duplicate check, pin, price tier, working hours"`

---

## Task 18: The `/crm` page — «مشتریان و سرنخ‌ها»

**Files:**
- Create: `app/(shell)/crm/page.tsx`, `components/crm/CrmBoard.tsx`, `components/crm/BusinessCard.tsx`
- Modify: `lib/appNav.ts`, `lib/pageMeta.ts`, `tests/appNav.test.ts`, `app/globals.css` (card styles)

**Interfaces:**
- Consumes: `listBusinesses`, `viewCounts`, `CRM_VIEWS`, `BusinessRow` (T9); `AfterCallFlow`, `AddLeadFlow` (T16–17); `useCallReturn` (T15); `CustomerSheet({ customerId, fallbackName, onClose })`; `useNavApp()` / `navigateUrl(app, { lat, lng }, label)`; `PageHeader({ route })`.
- Produces: the page; `CrmBoard({ initialRows, initialCounts, initialView })`; `BusinessCard({ row, mode, highlight, onCall, onOpen, onNavigate })`.

- [ ] **Step 1: Failing tests** — in `tests/appNav.test.ts` change the customers expectation and add one:

```ts
  it("customers: the CRM, the map, map pins, complaints and the photo gallery", () => {
    expect(hrefsIn("customers")).toEqual(["/crm", "/gallery", "/leads", "/map", "/sales/complaints"]);
  });
  it("the CRM is every role's but the driver's", () => {
    for (const role of ["owner", "group_manager", "rep_manager", "salesperson"] as const) {
      expect(appTabs({ role }).find((t) => t.href === "/crm")?.ready, role).toBe(true);
    }
  });
```

Run `npx vitest run tests/appNav.test.ts tests/pageMeta.test.ts` → FAIL.

- [ ] **Step 2: Nav and page copy**

`lib/appNav.ts` — first entry of the مشتریان group, and relabel `/leads`:

```ts
    // مشتریان
    { href: "/crm", label: "مشتریان و سرنخ‌ها", group: "customers", ready: r !== "driver" },
    { href: "/map", label: "نقشهٔ پوشش", group: "customers", ready: true },
    { href: "/leads", label: "پین‌های نقشه", group: "customers", ready: isRepLead(r) },
```

`lib/pageMeta.ts` — add `/crm`, retitle `/leads`:

```ts
  "/crm": {
    title: "مشتریان و سرنخ‌ها",
    overview:
      "همهٔ کسب‌وکارهایی که با آن‌ها کار دارید، از سرنخ تازه تا مشتری دائمی. تماس بگیرید، نتیجه را با چند لمس ثبت کنید، و ببینید امروز با چه کسی کار دارید.",
  },
  "/leads": {
    title: "پین‌های نقشه",
    overview:
      "مکان‌هایی که از روی لینک نقشه ذخیره شده‌اند و هنوز سرنخ نشده‌اند. امتیاز بدهید و آن‌هایی که ارزش بازدید دارند را به یک روز کاری تبدیل کنید.",
  },
```

- [ ] **Step 3: Card styles** — append to `app/globals.css` after the tap-flow block:

```css
/* ---- 8c · CRM list (/crm) -------------------------------------------------------- */
.meridian .crm-views { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
.meridian .crm-views button {
  flex: none; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card);
  color: var(--ink-2); font: inherit; font-size: 13px; cursor: pointer;
}
.meridian .crm-views button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.meridian .crm-views i { font-style: normal; opacity: .75; margin-inline-start: 4px; font-variant-numeric: tabular-nums; }
.meridian .crm-list { display: grid; gap: 10px; }
.meridian .crm-card { display: grid; gap: 6px; padding: 12px 14px; border-radius: var(--r-xl); background: var(--card); box-shadow: var(--sh-1); border: 1px solid transparent; }
.meridian .crm-card.hl { border-color: var(--accent); }
.meridian .crm-card .due { font-size: 12px; color: var(--muted); }
.meridian .crm-card .due.over { color: var(--crit); }
.meridian .crm-card .title { margin: 0; font-size: 15.5px; font-weight: 700; }
.meridian .crm-card .meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
.meridian .crm-card .pills { display: flex; gap: 4px; flex-wrap: wrap; }
.meridian .crm-card .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); white-space: nowrap; }
.meridian .crm-card .pill.warn { border-color: color-mix(in srgb, var(--warn) 45%, transparent); color: var(--warn); }
.meridian .crm-card .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-inline-end: 6px; background: var(--info); }
.meridian .crm-card .dot.hot { background: var(--crit); }
.meridian .crm-card .dot.warm { background: var(--warn); }
.meridian .crm-card .acts { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; margin-top: 2px; }
.meridian .crm-card .acts .btn { justify-content: center; min-height: 42px; }
```

- [ ] **Step 4: Implement** — `components/crm/BusinessCard.tsx`

```tsx
"use client";

import { Icon } from "@/components/meridian/Icon";
import type { BusinessRow } from "@/lib/repo/crm/businesses";
import { labelDue } from "@/lib/crm/due";
import { formatPhone } from "@/lib/crm/phone";
import {
  BUSINESS_TYPES, BUSINESS_TYPE_LABEL, CONTACT_ROLES, CONTACT_ROLE_LABEL, SALES_STAGES, SALES_STAGE_LABEL, isOneOf,
} from "@/lib/crm/vocab";

/** "next" mode is the pocket card (the task is the headline) for the follow-up views;
 *  "business" mode leads with the business, for browsing. Two buttons only: Call, Open. */
export default function BusinessCard({ row, mode, highlight, onCall, onOpen, onNavigate }: {
  row: BusinessRow; mode: "next" | "business"; highlight: boolean;
  onCall: (row: BusinessRow) => void; onOpen: (row: BusinessRow) => void; onNavigate: (row: BusinessRow) => void;
}) {
  const now = new Date().toISOString();
  const overdue = !!row.next_due_at && row.next_due_at < now;
  const stage = isOneOf(SALES_STAGES, row.sales_stage) ? SALES_STAGE_LABEL[row.sales_stage] : SALES_STAGE_LABEL.unknown;
  const type = isOneOf(BUSINESS_TYPES, row.business_type) ? BUSINESS_TYPE_LABEL[row.business_type] : null;
  const role = isOneOf(CONTACT_ROLES, row.contact_role) ? CONTACT_ROLE_LABEL[row.contact_role] : null;
  const contact = [row.contact_name, role].filter(Boolean).join(" · ") || "هنوز کسی را نمی‌شناسیم";
  const unverified = (row.verification ?? "unverified") === "unverified";
  const nextLine = row.next_title ? `${row.next_due_at ? labelDue(row.next_due_at, now) : ""} · ${row.next_title.split(" · ")[0]}` : "کار بعدی ندارد";

  return (
    <article className={`crm-card${highlight ? " hl" : ""}`}>
      <div className={`due${overdue ? " over" : ""}`}>{mode === "next" ? nextLine : [type, row.area_label].filter(Boolean).join(" · ")}</div>
      <p className="title">{mode === "next" ? (row.next_title?.split(" · ")[0] ?? row.business_name) : row.business_name}</p>
      <div className="meta">
        <span><span className={`dot ${row.temperature ?? "cold"}`} />{mode === "next" ? row.business_name : contact}</span>
        <span className="pills">
          {unverified ? <span className="pill warn">تأییدنشده</span> : null}
          {!row.phone_norm ? <span className="pill warn">بدون تلفن</span> : null}
          <span className="pill">{stage}</span>
        </span>
      </div>
      {mode === "business" && row.next_title ? <div className="due">{nextLine}</div> : null}
      <div className="acts">
        {row.phone_norm ? (
          <button type="button" className="btn solid" onClick={() => onCall(row)} aria-label={`تماس با ${formatPhone(row.phone_norm)}`}>
            <Icon name="phone" size="sm" /> تماس
          </button>
        ) : (
          <button type="button" className="btn solid" onClick={() => onNavigate(row)} disabled={row.lat === null}>
            <Icon name="route" size="sm" /> مسیریابی
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => onOpen(row)}>باز کن</button>
      </div>
    </article>
  );
}
```

`components/crm/CrmBoard.tsx`

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import BusinessCard from "./BusinessCard";
import AfterCallFlow from "./AfterCallFlow";
import AddLeadFlow from "./AddLeadFlow";
import { useCallReturn } from "./useCallReturn";
import CustomerSheet from "@/components/meridian/CustomerSheet";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import type { BusinessRow, CrmView } from "@/lib/repo/crm/businesses";
import { faDigits } from "@/lib/crm/vocab";

const VIEW_LABEL: Record<CrmView, string> = {
  today: "پیگیری امروز", hot: "داغ", my_leads: "سرنخ‌های من", my_customers: "مشتریان من",
  at_risk: "در خطر", unassigned: "بی‌صاحب", all: "همه",
};
const VIEW_ORDER: CrmView[] = ["today", "hot", "my_leads", "my_customers", "at_risk", "unassigned", "all"];
const NEXT_MODE: ReadonlySet<CrmView> = new Set<CrmView>(["today", "hot"]);

type CallFlow = { kind: "call"; customerId: number; entry: "call" | "talked_now"; open: boolean };
type LeadFlow = { kind: "lead"; open: boolean; prefillPhone: string | null };

export default function CrmBoard({ initialRows, initialCounts, initialView }: {
  initialRows: BusinessRow[]; initialCounts: Record<CrmView, number>; initialView: CrmView;
}) {
  const [view, setView] = useState<CrmView>(initialView);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [counts, setCounts] = useState(initialCounts);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [call, setCall] = useState<CallFlow | null>(null);
  const [lead, setLead] = useState<LeadFlow | null>(null);
  const [sheet, setSheet] = useState<{ id: number; name?: string } | null>(null);
  const [navApp] = useNavApp();

  const load = useCallback(async (v: CrmView, query: string) => {
    const j = (await fetch(`/api/crm/businesses?view=${v}&q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => null)) as
      { ok?: boolean; rows?: BusinessRow[]; counts?: Record<CrmView, number> } | null;
    if (j?.ok) { setRows(j.rows ?? []); setCounts(j.counts ?? initialCounts); }
  }, [initialCounts]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(view, q), q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [view, q, load]);

  const startCall = useCallReturn((customerId) => setCall({ kind: "call", customerId, entry: "call", open: true }));
  const finished = useCallback((id: number) => {
    setCall(null);
    setLead(null);
    setHighlight(id);
    void load(view, q);
  }, [load, view, q]);

  const onCall = (row: BusinessRow) => {
    if (call && call.customerId === row.id && !call.open) { setCall({ ...call, open: true }); return; } // resume a draft
    if (row.phone_norm) startCall(row.id, row.phone_norm);
  };
  const onNavigate = (row: BusinessRow) => {
    if (row.lat !== null && row.lng !== null) window.open(navigateUrl(navApp, { lat: row.lat, lng: row.lng }, row.business_name), "_blank", "noopener");
  };

  return (
    <div style={{ display: "grid", gap: 12, padding: "0 16px 96px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input className="tf-input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو نام، تلفن، محله…" aria-label="جستجو" />
        <button type="button" className="btn solid" onClick={() => setLead({ kind: "lead", open: true, prefillPhone: null })}>+ سرنخ</button>
      </div>
      <div className="crm-views" role="toolbar" aria-label="نمای فهرست">
        {VIEW_ORDER.map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}<i>{faDigits(String(counts[v] ?? 0))}</i>
          </button>
        ))}
      </div>
      <div className="crm-list">
        {rows.length === 0 ? <p className="tf-sub" style={{ textAlign: "center", padding: 24 }}>اینجا چیزی نیست.</p> : null}
        {rows.map((row) => (
          <BusinessCard key={row.id} row={row} mode={NEXT_MODE.has(view) ? "next" : "business"} highlight={highlight === row.id}
            onCall={onCall} onOpen={(r) => setSheet({ id: r.id, name: r.business_name })} onNavigate={onNavigate} />
        ))}
      </div>

      {call ? (
        <AfterCallFlow
          key={`${call.customerId}-${call.entry}`}
          customerId={call.customerId}
          entry={call.entry}
          open={call.open}
          onHide={() => setCall((c) => (c ? { ...c, open: false } : c))}
          onReopen={() => setCall((c) => (c ? { ...c, open: true } : c))}
          onFinished={finished}
          onRedial={(id, phone) => { setCall(null); startCall(id, phone); }}
          onSpawnLead={(phone) => { setCall(null); setLead({ kind: "lead", open: true, prefillPhone: phone }); }}
        />
      ) : null}
      {lead ? (
        <AddLeadFlow
          open={lead.open}
          prefillPhone={lead.prefillPhone}
          onHide={() => setLead((l) => (l ? { ...l, open: false } : l))}
          onReopen={() => setLead((l) => (l ? { ...l, open: true } : l))}
          onFinished={finished}
          onOpenExisting={(id) => { setLead(null); setSheet({ id }); }}
          onCallNow={(id, phone) => startCall(id, phone)}
          onOpenBusiness={(id) => setSheet({ id })}
          onTalkedNow={(id) => setCall({ kind: "call", customerId: id, entry: "talked_now", open: true })}
        />
      ) : null}
      <CustomerSheet customerId={sheet?.id ?? null} fallbackName={sheet?.name} onClose={() => setSheet(null)} />
    </div>
  );
}
```

`app/(shell)/crm/page.tsx`

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import PageHeader from "@/components/meridian/PageHeader";
import CrmBoard from "@/components/crm/CrmBoard";
import { listBusinesses, viewCounts } from "@/lib/repo/crm/businesses";

export const dynamic = "force-dynamic";

/** «مشتریان و سرنخ‌ها» -- the field CRM. Opens on today's follow-ups; falls back to "my
 *  leads" when there are none, so the first screen is never empty for a rep with work. */
export default async function CrmPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");
  getDb();
  const counts = viewCounts(session);
  const view = counts.today > 0 ? "today" : session.role === "salesperson" ? "my_leads" : "all";
  const { rows } = listBusinesses(session, { view });
  return (
    <>
      <PageHeader route="/crm" />
      <CrmBoard initialRows={rows} initialCounts={counts} initialView={view} />
    </>
  );
}
```

- [ ] **Step 5:** `npx vitest run tests/appNav.test.ts tests/pageMeta.test.ts && npx tsc --noEmit && npm run lint` → PASS / clean.
- [ ] **Step 6:** `git add app/(shell)/crm components/crm lib/appNav.ts lib/pageMeta.ts tests/appNav.test.ts app/globals.css && git commit -m "feat(crm): /crm page -- view chips, pocket cards, call → flow, add lead"`

---

## Task 19: Connect the flows to امروز and کارهای من

**Files:**
- Modify: `lib/repo/briefing.ts` (the `BriefingItem.action` type + the salesperson `open_tasks` panel), `components/today/Briefing.tsx`, `components/today/TaskRow.tsx`, `components/pocket/Pocket.tsx`
- Test: `tests/crm-briefing.test.ts`

**Interfaces:**
- Consumes: `AfterCallFlow` + `FlowHostProps` (T16); `TaskRow` from `lib/repo/tasks.ts` has `entity_type`, `entity_id`; `TaskCard.customer: { id, name } | null`.
- Produces: `BriefingItem.action = { kind: "task_outcome"; task_id: number; customer_id?: number } | { kind: "link"; href: string }`; `TaskRow({ taskId, label, sub, customerId? })`.

A CRM task opened from the to-do lists runs the **same** after-call flow, with `task_id`, so finishing it completes that task and creates the next one.

- [ ] **Step 1: Write the failing test** — `tests/crm-briefing.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-brief-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { todayFor } = await import("@/lib/repo/briefing");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("briefing → after-call flow", () => {
  it("carries the customer on a salesperson's customer task", () => {
    const db = getDb();
    const NOW = new Date().toISOString();
    const rep = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('br','x','br','salesperson',?,1)").run(NOW).lastInsertRowid);
    const c = Number(db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES ('BR-1','ب',?,1)").run(NOW).lastInsertRowid);
    db.prepare("INSERT INTO tasks (organization_id, assignee_user_id, kind, title, entity_type, entity_id, due_at, created_at) VALUES (1,?,'call','تماس اول','customer',?,?,?)").run(rep, c, NOW, NOW);
    db.prepare("INSERT INTO tasks (organization_id, assignee_user_id, kind, title, created_at) VALUES (1,?,'note','یادداشت',?)").run(rep, NOW);
    const s: Session = { user: { id: rep } as Session["user"], role: "salesperson", groupId: null, organizationId: 1 };
    const items = todayFor(s).panels.find((p) => p.key === "open_tasks")!.items;
    const call = items.find((i) => i.label === "تماس اول")!;
    const note = items.find((i) => i.label === "یادداشت")!;
    expect(call.action).toEqual({ kind: "task_outcome", task_id: expect.any(Number), customer_id: c });
    expect(note.action).toEqual({ kind: "task_outcome", task_id: expect.any(Number) });
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-briefing.test.ts` → FAIL (`customer_id` missing).

- [ ] **Step 3: Implement**

`lib/repo/briefing.ts`:

```ts
  action?: { kind: "task_outcome"; task_id: number; customer_id?: number } | { kind: "link"; href: string };
```

and in the salesperson `open_tasks` mapping:

```ts
          action:
            t.entity_type === "customer" && t.entity_id
              ? { kind: "task_outcome", task_id: t.id, customer_id: t.entity_id }
              : { kind: "task_outcome", task_id: t.id },
```

`components/today/Briefing.tsx`:

```tsx
    return <TaskRow taskId={item.action.task_id} customerId={item.action.customer_id} label={item.label} sub={item.sub} />;
```

`components/today/TaskRow.tsx` — accept `customerId?: number`; when present, the outcome chips give way to one button that opens the flow:

```tsx
import AfterCallFlow from "@/components/crm/AfterCallFlow";
// …
export default function TaskRow({ taskId, label, sub, customerId }: { taskId: number; label: string; sub?: string; customerId?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<ObjectionCard | null>(null);
  const [flow, setFlow] = useState<{ open: boolean } | null>(null);
  // … resolve() unchanged …
  return (
    <li className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] py-[var(--space-2)]">
      {/* label span unchanged */}
      <div className="flex flex-wrap gap-[var(--space-1)]">
        {customerId ? (
          <button type="button" className="btn solid" onClick={() => setFlow({ open: true })}>ثبت نتیجه</button>
        ) : (
          <OutcomeChips disabled={busy} onPick={(code) => void resolve(code)} />
        )}
        {/* the «حذف» button unchanged */}
      </div>
      {/* objection card unchanged */}
      {customerId && flow ? (
        <AfterCallFlow
          customerId={customerId}
          taskId={taskId}
          open={flow.open}
          onHide={() => setFlow({ open: false })}
          onReopen={() => setFlow({ open: true })}
          onFinished={() => { setFlow(null); router.refresh(); }}
        />
      ) : null}
    </li>
  );
}
```

`components/pocket/Pocket.tsx` — beside the customer-name button inside the card (the `{c.customer ? (<button … onClick={() => setCustId(c.customer!.id)}>` block), add the outcome button, and host one flow at the bottom of the component next to `<QuickAdd …/>`:

```tsx
import AfterCallFlow from "@/components/crm/AfterCallFlow";
// state, with the others at the top of Pocket():
const [flow, setFlow] = useState<{ customerId: number; taskId: number; open: boolean } | null>(null);
```

```tsx
          {c.customer && c.status === "open" && c.kind !== "order" && c.kind !== "delivery_retry" ? (
            <button type="button" className="btn solid" style={{ padding: "2px 10px", fontSize: 11 }}
              onClick={() => setFlow({ customerId: c.customer!.id, taskId: c.id, open: true })}>
              ثبت نتیجه
            </button>
          ) : null}
```

```tsx
      {flow ? (
        <AfterCallFlow
          key={flow.taskId}
          customerId={flow.customerId}
          taskId={flow.taskId}
          open={flow.open}
          onHide={() => setFlow((f) => (f ? { ...f, open: false } : f))}
          onReopen={() => setFlow((f) => (f ? { ...f, open: true } : f))}
          onFinished={() => { setFlow(null); void refetch(scopeId); }}
        />
      ) : null}
```

(`c` in that card is a `TaskCard`, which carries `status` and `kind`; `refetch` and `scopeId` already exist in `Pocket`.)

- [ ] **Step 4:** `npx vitest run tests/crm-briefing.test.ts tests/briefing-repo.test.ts && npx tsc --noEmit && npm run lint` → PASS / clean.
- [ ] **Step 5:** `git add lib/repo/briefing.ts components/today components/pocket/Pocket.tsx tests/crm-briefing.test.ts && git commit -m "feat(crm): امروز and کارهای من open the after-call flow for customer tasks"`

---

## Task 20: A delivered order makes a customer — on the same row

**Files:**
- Create: `lib/repo/crm/state.ts`, `lib/repo/crm/conversion.ts`
- Modify: `lib/repo/crm/write.ts` (move `recomputeState` out), `lib/repo/orders.ts` (`advanceOrder`)
- Test: `tests/crm-conversion.test.ts`

**Interfaces:**
- Consumes: `replayCrmState` (T4), `lifecycleFor` (T2), `ACTIVITY_FACT_COLUMNS` (T7), `advanceOrder(orgId, orderId, action, actor, opts?)`.
- Produces: `recomputeState(db, customerId)` now exported from `lib/repo/crm/state.ts` (write.ts imports it from there); `convertOnDelivery(conn, orgId, orderId, actorId)`.

Nothing sets `customers.first_order_at` today, so without this a lead who buys keeps showing as a lead. The hook runs inside `advanceOrder`'s transaction, on its connection. `state.ts` keeps the import graph acyclic: `orders.ts → crm/conversion → crm/state → crm/migrate → lib/crm/*`, with no path back to `orders.ts`.

- [ ] **Step 1: Write the failing test** — `tests/crm-conversion.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-conv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { advanceOrder } = await import("@/lib/repo/orders");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-10T08:00:00.000Z";
const db = getDb();
const rep = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('cv','x','cv','salesperson',?,1)").run(NOW).lastInsertRowid);
const lead = Number(db.prepare(`INSERT INTO customers (customer_code, business_name, owner_user_id, lifecycle, verification, sales_stage, contact_status, temperature, synced_at, organization_id)
  VALUES ('CV-1', 'سرنخ خریدار', ?, 'lead', 'unverified', 'unknown', 'not_contacted', 'cold', ?, 1)`).run(rep, NOW).lastInsertRowid);
let n = 0;
const order = (type = "SALE") =>
  Number(db.prepare(`INSERT INTO orders (order_no, customer_id, order_date, status, order_type, created_by, created_at, updated_at, organization_id)
    VALUES (?, ?, '2026-09-10', 'OUT_FOR_DELIVERY', ?, ?, ?, ?, 1)`).run(`CV-${++n}`, lead, type, rep, NOW, NOW).lastInsertRowid);
const row = () => db.prepare("SELECT sales_stage, lifecycle, verification, first_order_at FROM customers WHERE id = ?").get(lead) as Record<string, unknown>;

describe("conversion on delivery", () => {
  it("a delivered sample changes nothing", () => {
    advanceOrder(1, order("SAMPLE"), "deliver", { id: null, role: "system" });
    expect(row()).toMatchObject({ sales_stage: "unknown", lifecycle: "lead", first_order_at: null });
  });
  it("the first delivered sale makes a customer, verified, with first_order_at", () => {
    advanceOrder(1, order(), "deliver", { id: null, role: "system" });
    const r = row();
    expect(r).toMatchObject({ sales_stage: "first_order", lifecycle: "active", verification: "verified" });
    expect(r.first_order_at).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'order'").get(lead)).toEqual({ n: 1 });
  });
  it("the second makes a repeat customer and keeps the first date", () => {
    const first = row().first_order_at;
    advanceOrder(1, order(), "deliver", { id: null, role: "system" });
    expect(row()).toMatchObject({ sales_stage: "repeat_customer", first_order_at: first });
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/crm-conversion.test.ts` → FAIL (stage stays `unknown`). If it fails earlier on `consumeReservations` for an order with no reservations, give the test orders a `status` of `OUT_FOR_DELIVERY` *and* check `lib/repo/stock.ts consumeForOrder` is a no-op on zero rows — it should be; the delivery path already handles orders without reservations.

- [ ] **Step 3: Implement** — `lib/repo/crm/state.ts`

```ts
import type { DatabaseSync } from "node:sqlite";
import { replayCrmState } from "@/lib/crm/replay";
import { lifecycleFor } from "@/lib/crm/stage";
import type { CustomerLifecycle } from "@/lib/types";
import { ACTIVITY_FACT_COLUMNS } from "./migrate";

/** Rebuild the cached columns from the activities -- the replay guarantee (spec D9).
 *  Takes the connection so it can run inside a caller's transaction. */
export function recomputeState(db: DatabaseSync, customerId: number): void {
  const acts = db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(customerId) as never[];
  const s = replayCrmState(acts);
  const c = db.prepare("SELECT lifecycle, COALESCE(temperature_manual, 0) AS manual, temperature FROM customers WHERE id = ?").get(customerId) as
    { lifecycle: CustomerLifecycle; manual: number; temperature: string | null };
  db.prepare(`UPDATE customers SET contact_status = ?, sales_stage = ?, verification = ?, temperature = ?, attempt_count = ?,
                consecutive_misses = ?, last_activity_at = ?, last_contacted_at = ?, lifecycle = ? WHERE id = ?`)
    .run(s.contact_status, s.sales_stage, s.verification, c.manual ? c.temperature : s.temperature, s.attempt_count,
      s.consecutive_misses, s.last_activity_at, s.last_contacted_at, lifecycleFor(s.sales_stage, c.lifecycle), customerId);
}
```

In `lib/repo/crm/write.ts`: delete the `recomputeState` function, add `import { recomputeState } from "./state";`, and remove the imports only it used (`replayCrmState`, `lifecycleFor`, `ACTIVITY_FACT_COLUMNS`).

`lib/repo/crm/conversion.ts`

```ts
import type { DatabaseSync } from "node:sqlite";
import { recomputeState } from "./state";

/** A delivered SALE order makes the business a customer (the first) or a repeat customer
 *  (the second on) -- on the same row, never a copy (spec §2.6). A delivery also proves
 *  the business exists, so it verifies it. Runs inside advanceOrder's transaction. */
export function convertOnDelivery(conn: DatabaseSync, orgId: number, orderId: number, actorId: number | null): void {
  const o = conn.prepare("SELECT customer_id, COALESCE(order_type, 'SALE') AS order_type FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, orgId) as { customer_id: number; order_type: string } | undefined;
  if (!o || o.order_type !== "SALE") return;
  const n = (conn.prepare(`SELECT COUNT(*) n FROM orders WHERE customer_id = ? AND organization_id = ? AND COALESCE(order_type, 'SALE') = 'SALE'
                            AND status IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'CLOSED')`).get(o.customer_id, orgId) as { n: number }).n;
  const at = new Date().toISOString();
  conn.prepare(`INSERT INTO activities (organization_id, customer_id, user_id, type, note, stage_to, verification_to, occurred_at, created_at)
                VALUES (?, ?, ?, 'order', ?, ?, 'verified', ?, ?)`)
    .run(orgId, o.customer_id, actorId, `سفارش ${orderId} تحویل شد`, n >= 2 ? "repeat_customer" : "first_order", at, at);
  conn.prepare("UPDATE customers SET first_order_at = COALESCE(first_order_at, ?) WHERE id = ? AND organization_id = ?").run(at, o.customer_id, orgId);
  recomputeState(conn, o.customer_id);
}
```

`lib/repo/orders.ts` — import `convertOnDelivery` from `@/lib/repo/crm/conversion`, and in `advanceOrder`'s `apply()`, right after the `UPDATE orders SET status = ?` statement:

```ts
    // CRM: a delivered sale turns the lead into a customer on the same row.
    if (t.to === "DELIVERED" || t.to === "PARTIALLY_DELIVERED") convertOnDelivery(conn, organizationId, orderId, actor.id);
```

- [ ] **Step 4:** `npx vitest run tests/crm-conversion.test.ts tests/crm-write-repo.test.ts` and every order test (`npx vitest run tests/ -t order`) → PASS.
- [ ] **Step 5:** `git add lib/repo/crm lib/repo/orders.ts tests/crm-conversion.test.ts && git commit -m "feat(crm): a delivered sale converts the lead in place; repeat on the second"`

---

## Task 21: The driver's verification visits on `/driver`

**Files:**
- Create: `components/driver/VerifyVisits.tsx`
- Modify: `app/(bare)/driver/page.tsx` — render `<VerifyVisits />` on the line after `<SyncStatus />`

**Interfaces:**
- Consumes: `/api/crm/driver-visits` (T12); `TapFlow`, `FlowDone` (T14); `useHeldSave` (T15); `driverVisitFlow` (T6); `EMPTY_CONTEXT` (T5); `useMyPosition()`; `useNavApp()`, `navigateUrl`.
- Produces: `VerifyVisits()` — renders nothing when the driver has no visits.

- [ ] **Step 1: Implement** — `components/driver/VerifyVisits.tsx`

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useToast } from "@/components/ToastProvider";
import { useMyPosition } from "@/components/MyPositionProvider";
import { useNavApp } from "@/components/NavAppSetting";
import { useHeldSave } from "@/components/crm/useHeldSave";
import { navigateUrl } from "@/lib/navApps";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";
import { backStep, startFlow } from "@/lib/crm/flows/machine";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import { labelDue } from "@/lib/crm/due";
import type { DriverVisit } from "@/lib/repo/crm/driverVisits";

/** Phone-less leads the sales team wants checked, on this driver's round. */
export default function VerifyVisits() {
  const toast = useToast();
  const { position } = useMyPosition();
  const [navApp] = useNavApp();
  const { hold, cancel } = useHeldSave();
  const [visits, setVisits] = useState<DriverVisit[]>([]);
  const [flow, setFlow] = useState<{ visit: DriverVisit; ctx: FlowContext; state: FlowState; open: boolean } | null>(null);

  const load = useCallback(async () => {
    const j = (await fetch("/api/crm/driver-visits").then((r) => r.json()).catch(() => null)) as { ok?: boolean; visits?: DriverVisit[] } | null;
    if (j?.ok) setVisits(j.visits ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const start = (visit: DriverVisit) => {
    const ctx: FlowContext = { ...EMPTY_CONTEXT, entry: "driver_visit", vars: { name: visit.business_name, address: visit.address ?? visit.area_label ?? "" } };
    setFlow({ visit, ctx, state: startFlow(driverVisitFlow, ctx), open: true });
  };

  const onSaved = (st: FlowState) => {
    if (!flow) return;
    const { visit, ctx } = flow;
    const pos = position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : null;
    const uuid = crypto.randomUUID();
    hold(async () => {
      const res = await fetch(`/api/crm/driver-visits/${visit.task_id}`, {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: st.answers, pos, client_uuid: uuid }),
      });
      if (!res.ok) { toast("بازدید ذخیره نشد؛ دوباره امتحان کنید", "error"); return; }
      setFlow(null);
      void load();
    });
    toast("بازدید ثبت شد", "success", {
      label: "لغو",
      onClick: () => { if (cancel()) setFlow((f) => (f ? { ...f, state: backStep(driverVisitFlow, ctx, st), open: true } : f)); },
    });
  };

  if (visits.length === 0 && !flow) return null;
  const now = new Date().toISOString();

  return (
    <section style={{ display: "grid", gap: 10, padding: "0 16px 16px" }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>بازدیدهای تأیید</h2>
      <p className="tf-sub" style={{ margin: 0 }}>سرنخ‌هایی که تلفن ندارند. سر راه سر بزنید و چند سؤال را جواب دهید.</p>
      <div className="crm-list">
        {visits.map((v) => (
          <article key={v.task_id} className="crm-card">
            <div className="due">{v.due_at ? labelDue(v.due_at, now) : ""}{v.hours ? ` · باز: ${v.hours}` : ""}</div>
            <p className="title">{v.business_name}</p>
            <div className="meta"><span>{v.address ?? v.area_label ?? ""}</span></div>
            <div className="acts">
              <button type="button" className="btn solid" onClick={() => start(v)}>ثبت بازدید</button>
              <button type="button" className="btn ghost" disabled={v.lat === null || v.lng === null}
                onClick={() => v.lat !== null && v.lng !== null && window.open(navigateUrl(navApp, { lat: v.lat, lng: v.lng }, v.business_name), "_blank", "noopener")}>
                مسیریابی
              </button>
            </div>
          </article>
        ))}
      </div>
      {flow ? (
        <TapFlow
          open={flow.open}
          title={flow.visit.business_name}
          subtitle={flow.visit.address ?? undefined}
          config={driverVisitFlow}
          ctx={flow.ctx}
          state={flow.state}
          onState={(state) => setFlow((f) => (f ? { ...f, state } : f))}
          onSaved={onSaved}
          onClose={() => setFlow((f) => (f ? { ...f, open: false } : f))}
          done={<FlowDone chips={["مکان شما به‌عنوان مکان دقیق ثبت می‌شود"]} onReturn={() => setFlow((f) => (f ? { ...f, open: false } : f))} />}
        />
      ) : null}
    </section>
  );
}
```

`app/(bare)/driver/page.tsx`:

```tsx
import VerifyVisits from "@/components/driver/VerifyVisits";
// …
      <SyncStatus />
      <VerifyVisits />
```

- [ ] **Step 2:** `npx tsc --noEmit && npm run lint -- components/driver` → clean.
- [ ] **Step 3:** `git add components/driver/VerifyVisits.tsx "app/(bare)/driver/page.tsx" && git commit -m "feat(crm): drivers verify phone-less leads on their round"`

---

## Task 22: Verify everything, then hand over

**Files:** none new.

- [ ] **Step 1: Full suite** — `npx vitest run 2>&1 | tail -8` → every test green; the count is the Task 0 baseline plus the new CRM tests.
- [ ] **Step 2: Types and lint** — `npx tsc --noEmit && npm run lint` → clean, and `grep -rn "eslint-disable" lib/crm lib/repo/crm components/crm components/tapflow components/driver/VerifyVisits.tsx` prints nothing.
- [ ] **Step 3: Real-data migration** — copy production with the SQLite backup API (the DB runs in WAL mode; a plain `cp` is a stale snapshot) and run the lossless check against the copy:

```bash
node -e 'const s=require("node:sqlite");const db=new s.DatabaseSync("data/routeflow.db",{readOnly:true});s.backup(db,"/tmp/rf-crm-check.db").then(()=>console.log("backup ok"))'
ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/rf-crm-check.db npx vitest run tests/crm-migration-realdata.test.ts
```

Expected: PASS (not skipped), with every one of the ~142 businesses' stored state equal to its replay.

- [ ] **Step 4: Isolated manual pass** — never against production and never in the production checkout (a dev server there can clobber the live `.next`):

```bash
git worktree add /tmp/rf-crm-smoke crm-core-field-flows
ln -s /root/pourya/RouteFlow/node_modules /tmp/rf-crm-smoke/node_modules
cp /root/pourya/RouteFlow/.env* /tmp/rf-crm-smoke/ 2>/dev/null || true
node -e 'const s=require("node:sqlite");const db=new s.DatabaseSync("/root/pourya/RouteFlow/data/routeflow.db",{readOnly:true});s.backup(db,"/tmp/rf-crm-smoke.db").then(()=>console.log("ok"))'
cd /tmp/rf-crm-smoke && ROUTEFLOW_DB_PATH=/tmp/rf-crm-smoke.db npx next dev -p 3999
```

On a phone-sized window, in both skins:
1. `/crm` as a salesperson: view chips with counts; «پیگیری امروز» shows next-action cards; each card has only Call and Open (or Navigate when there is no phone).
2. Call a lead, come back: the after-call sheet opens by itself. «جواب نداد» → «فردا ۱۰:۰۰» saves in two taps; the toast shows «لغو» for 5 s; undo reopens the question with answers kept; left alone it saves and the list highlights the card with its new next action after 5 s.
3. An unverified lead: «صحبت کردیم» → «این همان … است؟» → «بله» → role chips → «قیمت خواست» → products → «ارسال در واتس‌اپ» opens WhatsApp with the price list.
4. «+ سرنخ» → «اسنپ‌فود» → «لینک ندارم» → a name, no phone → «روی نقشه» → pin, «آدرس تقریبی است» → «کافه» → «گران» → hours ۱۲–۱۶ and ۱۹–۲۴ → the first step offers «بازدید راننده در مسیر» and no call. The card shows «بدون تلفن» and «مسیریابی».
5. Type an existing phone in Add Lead: the blocking card appears; «شعبهٔ دیگری است» lets it through.
6. Log in as a driver: `/driver` shows «بازدیدهای تأیید»; finish one; the lead is verified with the driver's pin and the rep sees «تماس اول پس از بازدید» in کارهای من.
7. امروز and کارهای من: «ثبت نتیجه» on a customer task opens the same flow and completes that task.
8. Swipe down closes the sheet; ✕ and Escape too; keyboard focus rings are visible.

Stop the server by port (a name-based `pkill` misses it) and remove the worktree:

```bash
kill $(lsof -t -i:3999); git -C /root/pourya/RouteFlow worktree remove /tmp/rf-crm-smoke --force
```

- [ ] **Step 5: Push the branch, do not merge or deploy.** `git push -u origin crm-core-field-flows`. Merging to `main`, `npm run build` and `systemctl restart routeflow` happen with the user, after a fresh backup-API copy.

---

## Deviations from the spec (deliberate)

- **Events after commit.** Spec D9 says "in the same transaction"; `emitEvent` runs the rules engine, which opens its own transaction, so CRM events are appended immediately after COMMIT. The activity rows — the actual history — are inside the transaction.
- **`reason_codes` not widened yet.** Lead sources, lost / skip / not-fit reasons are closed vocabularies in `lib/crm/vocab.ts` for now; tenant-editable codes arrive with the analytics plan, which is the first consumer that needs them.
- **Drafts** survive while the page is open (the flow component stays mounted, hidden); a reload drops an unsaved draft.
- **Offline** CRM capture is deferred (D19).

## Out of scope — the next plans

- **P3 Business profile:** `/crm/[id]` with the timeline (activities, tasks, orders, payments), contacts editing, the optional fields the columns already hold (secondary phone, WhatsApp, Instagram, website, size band, segment tags), `product_interests`, `samples` (wrapping SAMPLE orders), `quotations` (accept → DRAFT order), temperature pin, reassign, merge. Until then «باز کن» opens the existing customer sheet.
- **P4 Daily queue:** the rules-engine sweeps (never contacted after 2 d, repair missing next action, quote follow-ups, reorder due), nearby grouping by district and position, hand-off to the visit planner; migrate the `/leads` pins into businesses and retire that page.
- **P5 Intelligence:** purchase pattern, reorder prediction, 4-state health with reasons, cross-sell.
- **P6 Analytics:** funnel, team leaderboard, sources, areas, lost reasons, samples.
