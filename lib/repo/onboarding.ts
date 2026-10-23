import { getDb } from "@/lib/db";
import { PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { onboardingChecklist, type Onboarding, type OnboardingFacts } from "@/lib/onboarding";

/** F40: the onboarding checklist for one customer of this organisation, or null if it is not one.
 *  Callers have already checked the person may see the customer. */
export async function onboardingFor(organizationId: number, customerId: number): Promise<Onboarding | null> {
  const row = await getDb()
    .prepare(
      `SELECT c.lat, c.lng, c.price_tier, c.contact_person, c.credit_limit_toman,
              (SELECT COUNT(*) FROM contacts k WHERE k.customer_id = c.id AND k.active = 1) AS contacts,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.organization_id = c.organization_id
                  AND o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})) AS confirmed
         FROM customers c
        WHERE c.id = ? AND c.organization_id = ?`
    )
    .get(customerId, organizationId) as unknown as (OnboardingFacts & { confirmed: number }) | undefined;
  return row ? onboardingChecklist(row, row.confirmed) : null;
}
