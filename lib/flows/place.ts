import type { FlowConfig, FlowState } from "@/lib/crm/flows/types";
import { FACILITY_KINDS, FACILITY_KIND_NAME, defaultIconFor, type FacilityKind } from "@/lib/facilityTypes";

/** Adding a place of ours: what kind, what it is called, where it is.
 *
 *  Where is answered standing there («اینجا هستم») or by dropping a pin; the pin step's own
 *  confirmation is the last answer and saves, so there is no save button. The marker shape is the
 *  kind's default (the desk form still lets a person choose another).
 *
 *  Contract: put kind; values.name; values.where = JSON { lat, lng, precision }. */
export const PLACE_KIND_LABEL: Record<FacilityKind, string> = {
  ...FACILITY_KIND_NAME,
  // The desk form says «خانه / مبدأ»: a home is also where routes start from.
  home: "خانه / مبدأ",
};

export const placeFlow: FlowConfig = {
  id: "place",
  start: () => "kind",
  budget: { common: 3, longest: 3 },
  steps: {
    kind: {
      id: "kind",
      kind: "choice",
      q: "این مکان چیست؟",
      options: FACILITY_KINDS.map((k) => ({ id: k, label: PLACE_KIND_LABEL[k], next: "name", put: { kind: k } })),
    },
    name: {
      id: "name",
      kind: "input",
      q: "نام مکان چیست؟",
      input: { field: "name", placeholder: "نام مکان" },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "where" }],
    },
    where: {
      id: "where",
      kind: "pin",
      q: "کجاست؟",
      sub: "اگر آن‌جا هستید «اینجا هستم» را بزنید، وگرنه روی نقشه پین بگذارید",
      options: [{ id: "ok", label: "ثبت موقعیت", tone: "rec", save: true }],
    },
  },
};

type Vals = Pick<FlowState, "values">;

/** The body POST /api/facilities expects. */
export function placeRequest(st: Vals) {
  const kind = st.values.kind as FacilityKind;
  const pin = JSON.parse(st.values.where) as { lat: number; lng: number };
  return { name: st.values.name.trim(), kind, icon_key: defaultIconFor(kind), lat: pin.lat, lng: pin.lng };
}

export function placeChips(st: Vals): string[] {
  return [st.values.name.trim(), PLACE_KIND_LABEL[st.values.kind as FacilityKind], "موقعیت ثبت شد"];
}
