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
import type { Db } from "@/lib/database/client";
import { orgOfUser } from "@/lib/repo/userOrg";
import { postCommissionPayment, syncOnePerson, type CommissionKind } from "@/lib/repo/ledgerCommission";
import { addShareholder, legalFormOf, listShareholders, setLegalForm, setShares, sharesAt, type LegalForm } from "@/lib/repo/shareholders";

type P<F extends (...a: never[]) => unknown> = Parameters<F>;

export const facilitiesIn = async (scope?: { sql: string; params: number[] }) => await readFacilities(getDb(), scope);
export const districtPropertiesIn = async (groupIds?: number[] | "all") => await readDistrictProperties(getDb(), groupIds);
export const leadListsIn = async (groupIds?: number[] | "all") => await readLeadLists(getDb(), groupIds);
export const customersIn = async (groupIds?: number[] | "all", attachDebt?: { organizationId: number }) => await readCustomers(getDb(), groupIds, attachDebt);

export const ordersIn = async (...a: P<typeof readOrders> extends [unknown, ...infer R] ? R : never) => await readOrders(getDb(), ...a);
export const orderMixIn = async (...a: P<typeof productMixFor> extends [unknown, ...infer R] ? R : never) => await productMixFor(getDb(), ...a);
export const orderById = async (id: number) => await readOrder(getDb(), id);
export const confirmOrderById = async (id: number) => await confirmOrder(getDb(), id);
export const addLineTo = async (id: number, line: P<typeof addLine>[2]) => await addLine(getDb(), id, line);
export const placeOrder = async (input: P<typeof createOrder>[1]) => await createOrder(getDb(), input);
export const customerSummaryIn = async (...a: P<typeof readCustomerSummary> extends [unknown, ...infer R] ? R : never) => await readCustomerSummary(getDb(), ...a);

export const addSalesRate = async (input: P<typeof setRate>[1]) => await setRate(getDb(), input);
export const addDriverRate = async (input: P<typeof setDriverRate>[1]) => await setDriverRate(getDb(), input);
export const addManagerOverride = async (input: P<typeof setManagerOverride>[1]) => await setManagerOverride(getDb(), input);
/** Record a commission payment and put it in the books in one transaction: first bring the person's
 *  accrual up to date (so 2103 never goes negative on a payment), then Dr 2103 / Cr cash. */
async function payAndPost(
  kind: CommissionKind,
  personId: number,
  input: { amount_toman: number; paid_on: string; created_by?: number | null },
  record: (db: Db) => Promise<number>
): Promise<number> {
  const db = getDb();
  return await db.tx(async () => {
    const id = await record(db);
    const organizationId = await orgOfUser(db, personId, input.created_by);
    const createdBy = input.created_by ?? personId;
    if (organizationId != null) {
      await syncOnePerson(db, { organizationId, kind, personId, asOf: input.paid_on, createdBy });
      await postCommissionPayment(db, {
        organizationId, kind, personId, createdBy, paymentId: id,
        amountToman: input.amount_toman, paidOn: input.paid_on,
      });
    }
    return id;
  });
}
export const paySales = async (input: P<typeof recordPayment>[1]) =>
  await payAndPost("sales", input.salesperson_user_id, input, (db) => recordPayment(db, input));
export const payDriver = async (input: P<typeof recordDriverPayment>[1]) =>
  await payAndPost("driver", input.driver_user_id, input, (db) => recordDriverPayment(db, input));
export const payManager = async (input: P<typeof recordManagerPayment>[1]) =>
  await payAndPost("manager", input.manager_user_id, input, (db) => recordManagerPayment(db, input));
export const setThresholds = async (productId: number, input: P<typeof setStockThresholds>[2]) => await setStockThresholds(getDb(), productId, input);

export const stockPositionIn = async (organizationId: number | null) => await advancedStockPosition(getDb(), organizationId);
export const purchasesIn = async (organizationId: number, limit: number) => await readPurchases(getDb(), organizationId, limit);
export const monthPurchasesIn = async (organizationId: number | null, monthFrom: string) => await monthPurchaseTotals(getDb(), organizationId, monthFrom);

export const draftsOf = async (organizationId: number, userId: number) => await readRunDrafts(getDb(), organizationId, userId);
export const commitDraftFor = async (input: P<typeof commitDraft>[1]) => await commitDraft(getDb(), input);
export const unloadOf = async (runId: number) => await pendingUnload(getDb(), runId);
export const runOwnedByDriver = async (runId: number, userId: number, orgId: number) => await runOwnedBy(getDb(), runId, userId, orgId);

export const impersonationTarget = async (userId: number) => await readImpersonationTarget(getDb(), userId);
export const impersonatableIn = async (organizationId: number | null) => await readImpersonatable(getDb(), organizationId);
export const logAccess = async (session: Session, path: string, organizationId: number | null) => await logPlatformAccess(getDb(), session, path, organizationId);

export const openOrdersOf = async (organizationId: number, customerId: number) => await deliveredOrdersForCustomer(getDb(), organizationId, customerId);

export const searchIn = async (session: Session, q: string) => ({
  districts: await searchDistricts(getDb(), session, q),
  customers: await searchCustomers(getDb(), session, q),
  orders: await searchOrders(getDb(), session, q),
  users: await searchUsers(getDb(), session, q),
  notes: await searchNotes(getDb(), session, q),
});

export const shareholdersOf = async (organizationId: number) => await listShareholders(getDb(), organizationId);
export const addShareholderIn = async (input: P<typeof addShareholder>[1]) => await addShareholder(getDb(), input);
export const setSharesIn = async (input: P<typeof setShares>[1]) => await setShares(getDb(), input);
export const sharesInForce = async (organizationId: number, groupId: number | null, onDate: string) => await sharesAt(getDb(), organizationId, groupId, onDate);
export const legalFormIn = async (organizationId: number) => await legalFormOf(getDb(), organizationId);
export const setLegalFormIn = async (organizationId: number, form: LegalForm) => await setLegalForm(getDb(), organizationId, form);
