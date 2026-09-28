import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { formatHours, parseHours } from "@/lib/crm/hours";
import { EMPTY_CONTEXT, type FlowAnswer } from "@/lib/crm/flows/types";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";
import { applyFlowCore, CrmError, type FlowWriteResult } from "./write";
import { isVanRole } from "../../roles";

export interface DriverVisit {
  task_id: number; customer_id: number; business_name: string; address: string | null; area_label: string | null;
  lat: number | null; lng: number | null; maps_url: string | null; hours: string; due_at: string | null;
}

/* A task is offered to a person when its hint names a role they HOLD. Matching one literal
   (`t.role_hint = 'driver'`) matches nobody the moment 'driver' stops being a role, and this
   fails silently: an empty list, no error, a field rep with no visits to make. 'driver' is
   still accepted for rows written before the migration. */
const VISIBLE = `t.organization_id = ? AND t.kind = 'verify_visit' AND t.status = 'open' AND t.entity_type = 'customer'
  AND (t.assignee_user_id = ? OR (t.assignee_user_id IS NULL
       AND t.role_hint IN ('field_rep', 'delivery_driver', 'driver')
       AND t.group_id = ?))`;

export function driverVisitsFor(session: Session): DriverVisit[] {
  if (!isVanRole(session.role)) throw new CrmError(403, "دسترسی لازم را ندارید");
  const rows = getDb()
    .prepare(`SELECT t.id AS task_id, c.id AS customer_id, c.business_name, c.address, c.area_label, c.lat, c.lng, c.maps_url,
                     c.working_hours_json, t.due_at
                FROM tasks t JOIN customers c ON c.id = t.entity_id
               WHERE ${VISIBLE} AND c.closed_at IS NULL
               ORDER BY COALESCE(t.due_at, '9999'), t.id`)
    .all(session.organizationId, session.user.id, session.groupId ?? -1) as unknown as (Omit<DriverVisit, "hours"> & { working_hours_json: string | null })[];
  return rows.map(({ working_hours_json, ...r }) => ({ ...r, hours: formatHours(parseHours(working_hours_json)) }));
}

export function applyDriverVisit(
  session: Session, taskId: number,
  input: { answers: FlowAnswer[]; pos?: { lat: number; lng: number; accuracy: number } | null; nowIso?: string; clientUuid?: string | null }
): FlowWriteResult {
  if (!isVanRole(session.role)) throw new CrmError(403, "دسترسی لازم را ندارید");
  const t = getDb()
    .prepare(`SELECT t.entity_id AS customer_id, c.business_name, c.address, c.area_label FROM tasks t JOIN customers c ON c.id = t.entity_id WHERE t.id = ? AND ${VISIBLE}`)
    .get(taskId, session.organizationId, session.user.id, session.groupId ?? -1) as
    { customer_id: number; business_name: string; address: string | null; area_label: string | null } | undefined;
  if (!t) throw new CrmError(404, "بازدید پیدا نشد");
  const ctx = { ...EMPTY_CONTEXT, entry: "driver_visit" as const, vars: { name: t.business_name, address: t.address ?? t.area_label ?? "" } };
  return applyFlowCore(session, driverVisitFlow, ctx, t.customer_id,
    { customerId: t.customer_id, answers: input.answers, entry: "call", channel: "visit", taskId, nowIso: input.nowIso, driverPos: input.pos ?? null, clientUuid: input.clientUuid },
    { claim: false });
}
