import type { FilterMenu } from "@/lib/filterSpec";

/** T1/A17: what the customers list can be filtered by. The label is what a person types: «شهر:تهران». */
export const CUSTOMER_FILTER_MENU: FilterMenu = [
  { key: "city", label: "شهر", kind: "text", column: "city" },
  { key: "area", label: "منطقه", kind: "text", column: "area_label" },
  { key: "type", label: "نوع", kind: "text", column: "customer_type" },
  { key: "business", label: "کسب‌وکار", kind: "text", column: "business_type" },
  { key: "lifecycle", label: "چرخه", kind: "text", column: "lifecycle" },
  { key: "limit", label: "سقف اعتبار", kind: "number", column: "credit_limit_toman" },
  { key: "since_purchase", label: "روز از خرید", kind: "days_since", column: "last_purchase_date" },
  { key: "owner", label: "مسئول", kind: "me", column: "owner_user_id" },
];
