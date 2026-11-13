/** Everything the map page reads, as a function of the session. */

import { getDb } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import { readDistrictProperties } from "@/lib/districts";
import { readFacilities } from "@/lib/facilities";
import { readGroups } from "@/lib/groups";
import { readLeadPins } from "@/lib/repo/leads";
import { groupFilterWithShared, orgScopeId, scopeGroupIds, type Session } from "@/lib/session";
import type { CustomerRow, MapCustomer } from "@/lib/types";

export async function mapPageData(session: Session) {
  const db = getDb();
  const scope = await scopeGroupIds(session);
  return {
    districts: await readDistrictProperties(db, scope),
    customers: (await readCustomers(db, scope, { organizationId: session.organizationId })).map(mapCustomer),
    facilities: await readFacilities(db, await groupFilterWithShared(session)),
    initialLeads: await readLeadPins(db, orgScopeId(session)),
    // Only the groups this caller can actually see: an owner gets all of them, a manager their own,
    // which is the only one any district they can see belongs to.
    visibleGroups: (await readGroups(db, session.organizationId))
      .filter((g) => scope === "all" || scope.includes(g.id))
      .map((g) => ({ id: g.id, name: g.name, color: g.color })),
  };
}

/** The fields the map reads (MapCustomer); the terms and credit ones stay off the page. */
function mapCustomer(c: CustomerRow): MapCustomer {
  return {
    id: c.id, customer_code: c.customer_code, business_name: c.business_name, contact_person: c.contact_person,
    phone: c.phone, address: c.address, city: c.city, province: c.province, lat: c.lat, lng: c.lng, district_id: c.district_id, contact_off: c.contact_off,
    lifecycle: c.lifecycle, salesperson: c.salesperson, debt: c.debt, notes: c.notes, synced_at: c.synced_at,
    last_purchase_date: c.last_purchase_date,
  };
}
