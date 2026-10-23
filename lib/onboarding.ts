/** F40: the four things a new customer needs before they can be served well, read from fields
 *  the record already has. A warning, never a block: an order for a shop with gaps still saves.
 *
 *  location  a point to drive to (lat and lng)
 *  price     a price group chosen (price_tier)
 *  contact   a person to call (an active contact, or the old contact_person field)
 *  credit    a credit limit set by someone (credit_limit_toman, zero included) */

export type OnboardingKey = "location" | "price" | "contact" | "credit";

export const ONBOARDING_LABEL: Record<OnboardingKey, string> = {
  location: "مکان روی نقشه",
  price: "گروه قیمت",
  contact: "مخاطب",
  credit: "سقف اعتبار",
};

export interface OnboardingFacts {
  lat: number | null;
  lng: number | null;
  price_tier: string | null;
  contacts: number;
  contact_person: string | null;
  credit_limit_toman: number | null;
}

export interface Onboarding {
  items: { key: OnboardingKey; label: string; done: boolean }[];
  missing: OnboardingKey[];
  /** No confirmed order yet: the checklist is still the customer's first-order checklist. */
  isNew: boolean;
}

export function onboardingChecklist(f: OnboardingFacts, confirmedOrders: number): Onboarding {
  const done: Record<OnboardingKey, boolean> = {
    location: f.lat !== null && f.lng !== null,
    price: !!f.price_tier?.trim(),
    contact: f.contacts > 0 || !!f.contact_person?.trim(),
    credit: f.credit_limit_toman !== null,
  };
  const keys: OnboardingKey[] = ["location", "price", "contact", "credit"];
  return {
    items: keys.map((key) => ({ key, label: ONBOARDING_LABEL[key], done: done[key] })),
    missing: keys.filter((k) => !done[k]),
    isNew: confirmedOrders === 0,
  };
}
