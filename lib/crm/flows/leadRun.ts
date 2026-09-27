import type { FlowConfig } from "./types";

/** Handing a manager's pool run to a driver: pick the driver, pick the day, confirm.
 *
 *  The two picker steps are host-rendered kinds, so TapFlow hands them to the host's
 *  `renderCustom` (see `LeadRunPlannerTabFlow`) instead of drawing its own option buttons;
 *  each of those screens must therefore submit one of the options declared here to move on.
 */
export const leadRunFlow: FlowConfig = {
  id: "lead_run",
  start: () => "driver",
  skipStep: "skip",
  budget: { common: 3, longest: 3 },
  steps: {
    driver: {
      id: "driver",
      kind: "driver",
      q: "راننده را انتخاب کنید",
      sub: "مسیر برای این راننده ثبت می‌شود",
      options: [{ id: "next", label: "ادامه", tone: "rec", next: "date" }],
      skipable: false,
    },
    date: {
      id: "date",
      kind: "date",
      q: "تاریخ را انتخاب کنید",
      sub: "روز مسیر تحویل",
      options: [{ id: "next", label: "ادامه", tone: "rec", next: "submit" }],
      skipable: false,
    },
    submit: {
      id: "submit",
      kind: "choice",
      q: "تایید و ثبت",
      sub: "اطلاعات را بررسی و ثبت کنید",
      // `save`, not `next`: it is what ends the flow and shows the `done` panel, so the
      // result -- saved or failed -- stays on screen instead of the sheet closing blind.
      options: [{ id: "confirm", label: "ثبت و سپردن", tone: "rec", save: true }],
      skipable: false,
    },
    skip: { id: "skip", kind: "choice", q: "", sub: "", options: [] },
  },
};
