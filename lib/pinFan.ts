import { navigateUrl, type NavAppId } from "@/lib/navApps";

/** The quick actions fanned out when a customer pin is held: call, order, navigate. Only the ones that can
 *  work are returned: no phone number means no call, a role that cannot sell gets no order, and a pin
 *  without coordinates cannot be navigated to. Pure, so each rule is tested. */
export interface PinAction {
  id: "call" | "order" | "navigate";
  label: string;
  icon: "phone" | "receipt" | "navigation";
  href: string;
}

export function pinActions(
  c: { id: number; business_name: string; phone: string | null; lat: number | null; lng: number | null },
  opts: { canOrder: boolean; navAppId: NavAppId },
): PinAction[] {
  const out: PinAction[] = [];
  if (c.phone) out.push({ id: "call", label: "تماس", icon: "phone", href: `tel:${c.phone}` });
  if (opts.canOrder) out.push({ id: "order", label: "ثبت سفارش", icon: "receipt", href: `/sales/orders/new?customer=${c.id}` });
  if (c.lat !== null && c.lng !== null) {
    out.push({ id: "navigate", label: "مسیریابی", icon: "navigation", href: navigateUrl(opts.navAppId, { lat: c.lat, lng: c.lng }, c.business_name) });
  }
  return out;
}

/** How long a finger must stay on a pin, and how far it may drift, to count as a hold. */
export const HOLD_PIN_MS = 450;
export const HOLD_PIN_SLOP_PX = 10;
