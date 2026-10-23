/** The remaining routes' view of readers and writers that take an explicit database handle: the same
 *  functions, with the handle held here rather than in each route, so a route imports a named
 *  operation and not the database. Each already takes the company (or a session, which carries it);
 *  nothing is added or removed here beyond the handle. */

import { getDb, readLeadLists } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import { readDistrictProperties } from "@/lib/districts";
import { readFacilities } from "@/lib/facilities";
import { readOrders, readOrder, confirmOrder, addLine, createOrder, productMixFor } from "@/lib/orders";
import { readCustomerSummary } from "@/lib/customerSummary";
import { setRate } from "@/lib/commissionLedger";
import { setDriverRate } from "@/lib/driverCommissionLedger";
import { recordPayment } from "@/lib/commissionLedger";
import { recordDriverPayment } from "@/lib/driverCommissionLedger";
import { recordManagerPayment, setManagerOverride } from "@/lib/managerCommissionLedger";
import { setStockThresholds } from "@/lib/catalogue";
import { advancedStockPosition, monthPurchaseTotals, readPurchases } from "@/lib/purchases";
import { commitDraft, readRunDrafts } from "@/lib/repo/runDrafts";
import { pendingUnload, runOwnedBy } from "@/lib/repo/unload";
import { readImpersonatable, readImpersonationTarget } from "@/lib/repo/impersonation";
import { deliveredOrdersForCustomer } from "@/lib/repo/payments";
import { searchCustomers, searchDistricts, searchNotes, searchOrders, searchUsers } from "@/lib/repo/search";
import { logPlatformAccess } from "@/lib/platformAccess";
import type { Session } from "@/lib/session";

type P<F extends (...a: never[]) => unknown> = Parameters<F>;

export const facilitiesIn = (scope?: { sql: string; params: number[] }) => readFacilities(getDb(), scope);
export const districtPropertiesIn = (groupIds?: number[] | "all") => readDistrictProperties(getDb(), groupIds);
export const leadListsIn = (groupIds?: number[] | "all") => readLeadLists(getDb(), groupIds);
export const customersIn = (groupIds?: number[] | "all", attachDebt?: { organizationId: number }) => readCustomers(getDb(), groupIds, attachDebt);

export const ordersIn = (...a: P<typeof readOrders> extends [unknown, ...infer R] ? R : never) => readOrders(getDb(), ...a);
export const orderMixIn = (...a: P<typeof productMixFor> extends [unknown, ...infer R] ? R : never) => productMixFor(getDb(), ...a);
export const orderById = (id: number) => readOrder(getDb(), id);
export const confirmOrderById = (id: number) => confirmOrder(getDb(), id);
export const addLineTo = (id: number, line: P<typeof addLine>[2]) => addLine(getDb(), id, line);
export const placeOrder = (input: P<typeof createOrder>[1]) => createOrder(getDb(), input);
export const customerSummaryIn = (...a: P<typeof readCustomerSummary> extends [unknown, ...infer R] ? R : never) => readCustomerSummary(getDb(), ...a);

export const addSalesRate = (input: P<typeof setRate>[1]) => setRate(getDb(), input);
export const addDriverRate = (input: P<typeof setDriverRate>[1]) => setDriverRate(getDb(), input);
export const addManagerOverride = (input: P<typeof setManagerOverride>[1]) => setManagerOverride(getDb(), input);
export const paySales = (input: P<typeof recordPayment>[1]) => recordPayment(getDb(), input);
export const payDriver = (input: P<typeof recordDriverPayment>[1]) => recordDriverPayment(getDb(), input);
export const payManager = (input: P<typeof recordManagerPayment>[1]) => recordManagerPayment(getDb(), input);
export const setThresholds = (productId: number, input: P<typeof setStockThresholds>[2]) => setStockThresholds(getDb(), productId, input);

export const stockPositionIn = (organizationId: number | null) => advancedStockPosition(getDb(), organizationId);
export const purchasesIn = (organizationId: number, limit: number) => readPurchases(getDb(), organizationId, limit);
export const monthPurchasesIn = (organizationId: number | null, monthFrom: string) => monthPurchaseTotals(getDb(), organizationId, monthFrom);

export const draftsOf = (organizationId: number, userId: number) => readRunDrafts(getDb(), organizationId, userId);
export const commitDraftFor = (input: P<typeof commitDraft>[1]) => commitDraft(getDb(), input);
export const unloadOf = (runId: number) => pendingUnload(getDb(), runId);
export const runOwnedByDriver = (runId: number, userId: number, orgId: number) => runOwnedBy(getDb(), runId, userId, orgId);

export const impersonationTarget = (userId: number) => readImpersonationTarget(getDb(), userId);
export const impersonatableIn = (organizationId: number | null) => readImpersonatable(getDb(), organizationId);
export const logAccess = (session: Session, path: string, organizationId: number | null) => logPlatformAccess(getDb(), session, path, organizationId);

export const openOrdersOf = (organizationId: number, customerId: number) => deliveredOrdersForCustomer(getDb(), organizationId, customerId);

export const searchIn = (session: Session, q: string) => ({
  districts: searchDistricts(getDb(), session, q),
  customers: searchCustomers(getDb(), session, q),
  orders: searchOrders(getDb(), session, q),
  users: searchUsers(getDb(), session, q),
  notes: searchNotes(getDb(), session, q),
});
