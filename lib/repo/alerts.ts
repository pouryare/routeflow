import { makeRepo } from "./base";

export class AlertError extends Error {}

export interface AlertRow {
  id: number;
  organization_id: number;
  severity: "critical" | "warning" | "opportunity";
  category: string;
  title: string;
  entity_type: string | null;
  entity_id: number | null;
  group_id: number | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: number | null;
}

export const alertsRepo = makeRepo<AlertRow>("alerts", { tenant: true });

export function raiseAlert(
  organizationId: number,
  input: {
    severity: AlertRow["severity"];
    category: string;
    title: string;
    entity_type?: string | null;
    entity_id?: number | null;
    group_id?: number | null;
  }
): number {
  return alertsRepo.insert(organizationId, {
    organization_id: organizationId,
    severity: input.severity,
    category: input.category,
    title: input.title,
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    group_id: input.group_id ?? null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
  } as Omit<AlertRow, "id">);
}

export function listAlerts(
  organizationId: number,
  filter: { severity?: string; open?: boolean; limit?: number } = {}
): AlertRow[] {
  const clauses = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.severity) {
    clauses.push("severity = ?");
    params.push(filter.severity);
  }
  if (filter.open) clauses.push("resolved_at IS NULL");
  params.push(filter.limit ?? 100);
  return alertsRepo
    .db()
    .prepare(
      `SELECT * FROM alerts WHERE ${clauses.join(" AND ")}
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`
    )
    .all(...(params as never[])) as unknown as AlertRow[];
}

export function resolveAlert(organizationId: number, id: number, by: number): void {
  const row = alertsRepo.get(organizationId, id);
  if (!row) throw new AlertError("هشدار پیدا نشد");
  alertsRepo.patch(organizationId, id, {
    resolved_at: new Date().toISOString(),
    resolved_by: by,
  });
}
