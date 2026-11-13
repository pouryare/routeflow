/* S24: «گزارش مشکل برنامه». Anyone signed in can send one; the owner reads the open ones on the status page and
 * marks them done. shortcut: the screenshot is a shrunk picture kept in the row (max ~450 KB); move it to the
 * storage layer if reports ever carry more than a picture. */
import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";

export class ReportError extends Error {}

export interface ProblemReportInput {
  message: unknown;
  page?: unknown;
  connection?: unknown;
  userAgent?: unknown;
  screenshot?: unknown;
  appVersion: string;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
/** A data URL of a picture, small enough to keep (the client shrinks it first). */
const SHOT = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export async function addProblemReport(s: Session, input: ProblemReportInput): Promise<void> {
  const message = text(input.message, 1000);
  if (!message) throw new ReportError("بنویسید چه مشکلی پیش آمد");
  const shot = typeof input.screenshot === "string" && input.screenshot ? input.screenshot : null;
  if (shot && (shot.length > 600_000 || !SHOT.test(shot))) throw new ReportError("تصویر پذیرفته نشد؛ بدون تصویر بفرستید یا تصویر کوچک‌تری بگذارید");
  await getDb()
    .prepare(
      `INSERT INTO problem_reports (organization_id, user_id, role, message, page, app_version, user_agent, connection, screenshot_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(s.organizationId, s.user.id, s.role, message, text(input.page, 300), input.appVersion, text(input.userAgent, 300), text(input.connection, 60), shot, new Date().toISOString());
}

export interface ProblemReportRow {
  id: number;
  who: string;
  role: string;
  message: string;
  page: string | null;
  app_version: string | null;
  user_agent: string | null;
  connection: string | null;
  has_screenshot: boolean;
  created_at: string;
}

/** Open reports, newest first (the owner's list). */
export async function openProblemReports(organizationId: number, limit = 30): Promise<ProblemReportRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.id, COALESCE(u.display_name, u.username) AS who, r.role, r.message, r.page, r.app_version, r.user_agent, r.connection,
              (r.screenshot_data IS NOT NULL) AS has_screenshot, r.created_at
         FROM problem_reports r JOIN users u ON u.id = r.user_id
        WHERE r.organization_id = ? AND r.status = 'open' ORDER BY r.id DESC LIMIT ?`
    )
    .all(organizationId, limit)) as unknown as (Omit<ProblemReportRow, "has_screenshot"> & { has_screenshot: boolean | number })[];
  return rows.map((r) => ({ ...r, has_screenshot: !!r.has_screenshot }));
}

export async function screenshotOf(organizationId: number, id: number): Promise<string | null> {
  const r = (await getDb().prepare("SELECT screenshot_data FROM problem_reports WHERE id = ? AND organization_id = ?").get(id, organizationId)) as { screenshot_data: string | null } | undefined;
  return r?.screenshot_data ?? null;
}

export async function markReportDone(organizationId: number, id: number): Promise<void> {
  await getDb().prepare("UPDATE problem_reports SET status = 'done', done_at = ? WHERE id = ? AND organization_id = ? AND status = 'open'").run(new Date().toISOString(), id, organizationId);
}
