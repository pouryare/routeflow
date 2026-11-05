/** Whether decorative effects (coin turn, ticket edge, light on a card, photo and crumple motion) play.
 *  Off wins from any side: the company owner's switch, the person's own switch, reduced motion, or a weak
 *  phone. Pure, so the order of those rules is tested. */

export type CompanyFx = "auto" | "off";
export type PersonFx = "on" | "off" | null;

export const isCompanyFx = (v: unknown): v is CompanyFx => v === "auto" || v === "off";

/** A phone is weak with 2 GB of memory or less, or 4 cores or fewer; unknown values do not count as weak. */
export function isWeakPhone(deviceMemory: number | undefined, cores: number | undefined): boolean {
  return (deviceMemory !== undefined && deviceMemory <= 2) || (cores !== undefined && cores <= 4);
}

export function fxOn(o: { company: CompanyFx; person: PersonFx; reducedMotion: boolean; weak: boolean }): boolean {
  if (o.company === "off" || o.person === "off" || o.reducedMotion) return false;
  if (o.person === "on") return true; // the person chose to see them, even on a weak phone
  return !o.weak;
}
