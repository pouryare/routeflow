import type { DeliveryStop } from "./deliveryParse";

export interface ResolvedStop extends DeliveryStop {
  customerId: number | null;
  resolvedLat: number | null;
  resolvedLng: number | null;
  matched: boolean;
}
