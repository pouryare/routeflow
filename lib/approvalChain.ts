/** F129 first slice: when does an approval need the owner after the group manager? Pure rule.
 *  Example: limit 5,000,000 and an order of 8,000,000 parked for credit: the group manager's «تأیید» sends it on to the owner;
 *  an order of 3,000,000 is decided by the manager alone, as before. */
export function approvalAmount(a: { kind: string; customer_balance_toman: number; overage_toman: number }): number {
  return a.kind === "credit" ? Number(a.overage_toman) : Number(a.customer_balance_toman);
}

export const needsOwnerStep = (a: { kind: string; customer_balance_toman: number; overage_toman: number }, ownerLimitToman: number): boolean =>
  ownerLimitToman > 0 && approvalAmount(a) > ownerLimitToman;
