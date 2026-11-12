/* Company lessons for the Academy (docs/plans/academy-catalogue-independence-2026-11-12.md AC1 to AC4).
 *
 * Two layers share one screen: the lessons shipped with the app (files in content/academy, the same for
 * every company, lib/repo/academy.ts) and the lessons a company writes itself, here, in categories it
 * creates. A company lesson is addressed as `c-<id>` wherever a slug is expected (lesson_progress,
 * the reader's address), so the two never clash. */
import { getDb, plain } from "@/lib/db";
import type { Session } from "@/lib/session";
import { isOwner, ROLES, type Role } from "@/lib/roles";

export class LessonError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const COMPANY_PREFIX = "c-";
export const companySlug = (id: number) => `${COMPANY_PREFIX}${id}`;
/** The lesson id behind a `c-<id>` slug, or null for a shipped lesson. */
export const companyLessonId = (slug: string): number | null => {
  const m = /^c-(\d+)$/.exec(slug);
  return m ? Number(m[1]) : null;
};

export interface CategoryRow {
  id: number;
  title: string;
  sort_order: number;
}

export interface LessonRow {
  id: number;
  organization_id: number;
  category_id: number | null;
  group_id: number | null;
  title: string;
  body: string;
  roles: string;
  required: number;
  due_days: number | null;
  status: "draft" | "published";
  version: number;
  reread_version: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Owner, group manager (their own group's lessons) and any person the owner made a «مربی». */
export function canAuthorLessons(s: Session): boolean {
  return isOwner(s.role) || s.role === "group_manager" || Boolean(s.user.can_teach);
}

/** Owner: every lesson. Group manager: lessons of their group. Trainer: lessons they wrote. */
export function canEditLesson(s: Session, l: Pick<LessonRow, "group_id" | "created_by">): boolean {
  if (isOwner(s.role)) return true;
  if (s.role === "group_manager" && s.groupId !== null && l.group_id === s.groupId) return true;
  return Boolean(s.user.can_teach) && l.created_by === s.user.id;
}

const rolesOf = (l: Pick<LessonRow, "roles">): string[] => (l.roles ? l.roles.split(",").filter(Boolean) : []);

/** Whether `s` is meant to read a published lesson: company-wide or their group's, for their role or everyone. */
export function lessonReaches(s: Session, l: Pick<LessonRow, "group_id" | "roles">): boolean {
  if (isOwner(s.role)) return true;
  if (l.group_id !== null && l.group_id !== s.groupId) return false;
  const roles = rolesOf(l);
  return roles.length === 0 || roles.some((r) => s.hasRole(r as Role));
}

/** A finished lesson counts only while the version read is the one the author asked everybody to have read. */
export const stillDone = (l: Pick<LessonRow, "reread_version">, versionRead: number) => versionRead >= l.reread_version;

export async function listCategories(organizationId: number): Promise<CategoryRow[]> {
  return plain(
    (await getDb()
      .prepare("SELECT id, title, sort_order FROM academy_categories WHERE organization_id = ? ORDER BY sort_order, id")
      .all(organizationId)) as unknown as CategoryRow[]
  );
}

function cleanTitle(raw: unknown, what: string, max: number): string {
  const t = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!t) throw new LessonError(`${what} را بنویسید`);
  if (t.length > max) throw new LessonError(`${what} حداکثر ${max} نویسه باشد`);
  return t;
}

export async function createCategory(s: Session, title: unknown): Promise<number> {
  if (!canAuthorLessons(s)) throw new LessonError("اجازهٔ نوشتن درس ندارید", 403);
  const t = cleanTitle(title, "نام دسته", 80);
  const db = getDb();
  const next = Number(((await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM academy_categories WHERE organization_id = ?").get(s.organizationId)) as { n: number }).n);
  const r = await db
    .prepare("INSERT INTO academy_categories (organization_id, title, sort_order, created_at) VALUES (?, ?, ?, ?)")
    .run(s.organizationId, t, next, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export async function renameCategory(s: Session, id: number, title: unknown): Promise<void> {
  if (!isOwner(s.role)) throw new LessonError("فقط مالک نام دسته را عوض می‌کند", 403);
  const r = await getDb()
    .prepare("UPDATE academy_categories SET title = ? WHERE id = ? AND organization_id = ?")
    .run(cleanTitle(title, "نام دسته", 80), id, s.organizationId);
  if (!Number(r.changes)) throw new LessonError("دسته پیدا نشد", 404);
}

/** Only an empty category can go; its lessons are never lost with it. */
export async function deleteCategory(s: Session, id: number): Promise<void> {
  if (!isOwner(s.role)) throw new LessonError("فقط مالک دسته را پاک می‌کند", 403);
  const db = getDb();
  const used = Number(((await db.prepare("SELECT COUNT(*) AS n FROM academy_lessons WHERE category_id = ? AND organization_id = ?").get(id, s.organizationId)) as { n: number }).n);
  if (used > 0) throw new LessonError("در این دسته درس هست؛ اول درس‌ها را جابه‌جا یا پاک کنید", 409);
  await db.prepare("DELETE FROM academy_categories WHERE id = ? AND organization_id = ?").run(id, s.organizationId);
}

/** Lessons this person may open: published ones meant for them, plus every draft they could edit. */
export async function listCompanyLessons(s: Session): Promise<LessonRow[]> {
  const rows = plain(
    (await getDb()
      .prepare("SELECT * FROM academy_lessons WHERE organization_id = ? ORDER BY category_id NULLS LAST, id")
      .all(s.organizationId)) as unknown as LessonRow[]
  );
  return rows.filter((l) => (l.status === "published" ? lessonReaches(s, l) : canEditLesson(s, l)));
}

export async function getCompanyLesson(s: Session, id: number): Promise<LessonRow | null> {
  const l = (await getDb().prepare("SELECT * FROM academy_lessons WHERE id = ? AND organization_id = ?").get(id, s.organizationId)) as unknown as LessonRow | undefined;
  if (!l) return null;
  const row = plain([l])[0];
  return (row.status === "published" ? lessonReaches(s, row) : canEditLesson(s, row)) ? row : null;
}

export interface LessonInput {
  id?: number;
  title: unknown;
  category_id?: number | null;
  body?: unknown;
  roles?: unknown;
  required?: unknown;
  due_days?: unknown;
  publish?: unknown;
  /** Ask everybody who finished this lesson to read it again (the version after this edit). */
  reread?: unknown;
}

/** Creates or edits a lesson. A group manager's lessons carry their group; an edit that asks for a re-read
 *  raises `reread_version` to the new version, so earlier completions stop counting. */
export async function saveLesson(s: Session, input: LessonInput): Promise<number> {
  if (!canAuthorLessons(s)) throw new LessonError("اجازهٔ نوشتن درس ندارید", 403);
  const db = getDb();
  const title = cleanTitle(input.title, "عنوان درس", 120);
  const body = typeof input.body === "string" ? input.body : "";
  if (body.length > 20000) throw new LessonError("متن درس از ۲۰٬۰۰۰ نویسه بیشتر است");
  const roles = Array.isArray(input.roles) ? input.roles.filter((r): r is string => typeof r === "string" && (ROLES as string[]).includes(r)) : [];
  const due = input.due_days === null || input.due_days === undefined || input.due_days === "" ? null : Number(input.due_days);
  if (due !== null && !(Number.isInteger(due) && due >= 1 && due <= 365)) throw new LessonError("مهلت باید بین ۱ تا ۳۶۵ روز باشد");
  const required = input.required === true;
  if (required && roles.length === 0) throw new LessonError("درس اجباری باید برای دست‌کم یک نقش باشد");
  const status = input.publish === true ? "published" : "draft";
  if (input.category_id) {
    const c = await db.prepare("SELECT 1 AS ok FROM academy_categories WHERE id = ? AND organization_id = ?").get(Number(input.category_id), s.organizationId);
    if (!c) throw new LessonError("دسته پیدا نشد", 404);
  }
  const category = input.category_id ? Number(input.category_id) : null;
  const now = new Date().toISOString();

  if (input.id) {
    const cur = (await db.prepare("SELECT * FROM academy_lessons WHERE id = ? AND organization_id = ?").get(input.id, s.organizationId)) as unknown as LessonRow | undefined;
    if (!cur) throw new LessonError("درس پیدا نشد", 404);
    if (!canEditLesson(s, cur)) throw new LessonError("این درس را نمی‌توانید ویرایش کنید", 403);
    const version = Number(cur.version) + 1;
    await db
      .prepare(
        `UPDATE academy_lessons SET title = ?, category_id = ?, body = ?, roles = ?, required = ?, due_days = ?,
                status = ?, version = ?, reread_version = ?, updated_by = ?, updated_at = ? WHERE id = ? AND organization_id = ?`
      )
      .run(title, category, body, roles.join(","), required, due, status, version, input.reread === true ? version : Number(cur.reread_version), s.user.id, now, input.id, s.organizationId);
    return input.id;
  }
  const r = await db
    .prepare(
      `INSERT INTO academy_lessons (organization_id, category_id, group_id, title, body, roles, required, due_days, status,
                                    created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(s.organizationId, category, s.role === "group_manager" ? s.groupId : null, title, body, roles.join(","), required, due, status, s.user.id, s.user.id, now, now);
  return Number(r.lastInsertRowid);
}

export async function deleteLesson(s: Session, id: number): Promise<void> {
  const db = getDb();
  const cur = (await db.prepare("SELECT * FROM academy_lessons WHERE id = ? AND organization_id = ?").get(id, s.organizationId)) as unknown as LessonRow | undefined;
  if (!cur) throw new LessonError("درس پیدا نشد", 404);
  if (!canEditLesson(s, cur)) throw new LessonError("این درس را نمی‌توانید پاک کنید", 403);
  await db.tx(async () => {
    await db.prepare("DELETE FROM lesson_progress WHERE organization_id = ? AND lesson_slug = ?").run(s.organizationId, companySlug(id));
    await db.prepare("DELETE FROM academy_lessons WHERE id = ? AND organization_id = ?").run(id, s.organizationId);
  });
}

/** The owner gives or takes back the «مربی» permission. */
export async function setTrainer(s: Session, userId: number, on: boolean): Promise<void> {
  if (!isOwner(s.role)) throw new LessonError("فقط مالک مربی تعیین می‌کند", 403);
  const r = await getDb().prepare("UPDATE users SET can_teach = ? WHERE id = ? AND organization_id = ?").run(on, userId, s.organizationId);
  if (!Number(r.changes)) throw new LessonError("کاربر پیدا نشد", 404);
}

export async function listPeopleForTrainers(s: Session): Promise<{ id: number; name: string; role: string; can_teach: boolean }[]> {
  if (!isOwner(s.role)) return [];
  const rows = (await getDb()
    .prepare("SELECT id, display_name AS name, role, can_teach FROM users WHERE organization_id = ? AND active = 1 ORDER BY display_name, id")
    .all(s.organizationId)) as unknown as { id: number; name: string; role: string; can_teach: number }[];
  return plain(rows).map((r) => ({ ...r, can_teach: Boolean(r.can_teach) }));
}
