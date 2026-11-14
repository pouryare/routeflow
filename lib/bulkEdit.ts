/** T4: changing the salesperson or group of many customers at once. Pure rules here; the database part is lib/repo/bulkEdit.ts. */
import type { Role } from "@/lib/roles";

export type BulkActor = { organizationId: number; userId: number; role: Role; groupId: number | null };
export type BulkField = "owner" | "group";
export type BulkPlan = { ids: number[]; field: BulkField; value: number | null };

/** Above this many customers the change runs on the worker (E7) instead of in the request. */
export const BULK_INLINE_MAX = 100;
/** One request never names more than this many customers. */
const BULK_MAX = 2000;

export function bulkPlanProblem(p: { ids: unknown; field: unknown; value: unknown }): string | null {
  if (!Array.isArray(p.ids) || p.ids.length === 0) return "مشتری‌ای انتخاب نشده است";
  if (p.ids.length > BULK_MAX || !p.ids.every((i) => Number.isInteger(i) && i > 0)) return "فهرست انتخاب‌شده درست نیست";
  if (p.field !== "owner" && p.field !== "group") return "چیزی برای تغییر انتخاب نشده است";
  if (p.value !== null && !(Number.isInteger(p.value) && (p.value as number) > 0)) return "مقدار تازه درست نیست";
  return null;
}

/** «۴۲ مشتری تغییر می‌کند؛ ۳ مورد همین الان همین‌طور است.» */
export function bulkPreviewText(count: number, same: number, refused: number): string {
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const parts = [`${fa(count)} مشتری تغییر می‌کند`];
  if (same > 0) parts.push(`${fa(same)} مورد همین الان همین‌طور است`);
  if (refused > 0) parts.push(`${fa(refused)} مورد در دسترس شما نیست`);
  return parts.join("؛ ");
}
