/** The standard onboarding checklist seeded for every new representative. Code, not a
 *  table: a tenant does not edit this list in Phase 0b. `training_module_6` is the tie
 *  to the academy's rep-recruitment module (Phase 8) and is the one optional step. */
export const ONBOARDING_STEPS: {
  step_code: string;
  label_fa: string;
  required: boolean;
  sort_order: number;
}[] = [
  { step_code: "contract_signed", label_fa: "امضای قرارداد", required: true, sort_order: 1 },
  { step_code: "territory_assigned", label_fa: "تخصیص منطقهٔ فعالیت", required: true, sort_order: 2 },
  { step_code: "price_list_assigned", label_fa: "تعیین لیست قیمت نماینده", required: true, sort_order: 3 },
  { step_code: "credit_terms_set", label_fa: "تعیین شرایط پرداخت", required: true, sort_order: 4 },
  { step_code: "first_stock_order", label_fa: "ثبت اولین سفارش تأمین", required: true, sort_order: 5 },
  { step_code: "training_module_6", label_fa: "گذراندن دورهٔ آموزش نماینده", required: false, sort_order: 6 },
];
