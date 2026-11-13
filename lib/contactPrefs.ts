/** S15: what a customer asked us not to do. Example: «تماس نشود» after the customer said "don't call me again". */
export const CONTACT_CHANNELS = [
  { id: "calls", label: "تماس تلفنی" },
  { id: "promo", label: "پیام تبلیغاتی" },
  { id: "service", label: "پیام خدماتی" },
] as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number]["id"];

export interface ContactOff {
  channel: ContactChannel;
  reason: string;
  set_at: string;
  set_by_name: string | null;
}

export function isContactChannel(v: unknown): v is ContactChannel {
  return CONTACT_CHANNELS.some((c) => c.id === v);
}
