export type RepStage =
  | "prospect"
  | "qualified"
  | "negotiating"
  | "documents"
  | "approved"
  | "onboarding"
  | "active"
  | "dormant"
  | "terminated";

/** The pipeline a representative moves through. Linear to `active`, then sleep/wake, and
 *  `terminated` reachable from any non-terminal stage. `-> active` also carries a guard
 *  in the repo (all required onboarding steps done). */
export const REP_STAGE_TRANSITIONS: Record<RepStage, RepStage[]> = {
  prospect: ["qualified", "terminated"],
  qualified: ["negotiating", "terminated"],
  negotiating: ["documents", "terminated"],
  documents: ["approved", "terminated"],
  approved: ["onboarding", "terminated"],
  onboarding: ["active", "terminated"],
  active: ["dormant", "terminated"],
  dormant: ["active", "terminated"],
  terminated: [],
};

export function canAdvance(from: RepStage, to: RepStage): boolean {
  return REP_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const REP_STAGE_LABEL: Record<RepStage, string> = {
  prospect: "شناسایی",
  qualified: "ارزیابی‌شده",
  negotiating: "مذاکره",
  documents: "مدارک",
  approved: "تأییدشده",
  onboarding: "در حال پذیرش",
  active: "فعال",
  dormant: "غیرفعال",
  terminated: "خاتمه‌یافته",
};
