import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { FACILITY_KINDS, defaultIconFor } from "@/lib/facilityTypes";
import { placeFlow, placeRequest, placeChips, PLACE_KIND_LABEL } from "@/lib/flows/place";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = { ...EMPTY_CONTEXT, entry: "place" };
const pin = JSON.stringify({ lat: 35.7, lng: 51.4, precision: "exact" });

describe("create-a-place flow", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(placeFlow, [{ ctx, values: { name: "انبار دوم", where: pin } }]);
    assertNoRawEnumLabels(placeFlow);
  });

  it("offers every kind the app knows, in words", () => {
    const v = viewStep(placeFlow, ctx, startFlow(placeFlow, ctx));
    expect(v.options.map((o) => o.id)).toEqual(FACILITY_KINDS);
    for (const k of FACILITY_KINDS) expect(PLACE_KIND_LABEL[k]).toBeTruthy();
  });

  it("kind, name, then the position saves: 3 answers, no save button", () => {
    let st = startFlow(placeFlow, ctx);
    st = answerStep(placeFlow, ctx, st, "cold_storage");
    st = answerStep(placeFlow, ctx, st, "ok", "سردخانه شمال");
    expect(viewStep(placeFlow, ctx, st).id).toBe("where");
    st = answerStep(placeFlow, ctx, st, "ok", pin);
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(3);
    expect(placeRequest(st)).toEqual({
      name: "سردخانه شمال", kind: "cold_storage", icon_key: defaultIconFor("cold_storage"), lat: 35.7, lng: 51.4,
    });
  });

  it("the name is required and is trimmed", () => {
    let st = answerStep(placeFlow, ctx, startFlow(placeFlow, ctx), "warehouse");
    expect(() => answerStep(placeFlow, ctx, st, "ok")).toThrow();
    st = answerStep(placeFlow, ctx, st, "ok", "  انبار دوم ");
    st = answerStep(placeFlow, ctx, st, "ok", pin);
    expect(placeRequest(st).name).toBe("انبار دوم");
  });

  it("the done line states name, kind and that the position is set", () => {
    let st = answerStep(placeFlow, ctx, startFlow(placeFlow, ctx), "office");
    st = answerStep(placeFlow, ctx, st, "ok", "دفتر مرکزی");
    st = answerStep(placeFlow, ctx, st, "ok", pin);
    const chips = placeChips(st).join(" | ");
    expect(chips).toContain("دفتر مرکزی");
    expect(chips).toContain(PLACE_KIND_LABEL.office);
    expect(chips).toContain("موقعیت ثبت شد");
  });
});
