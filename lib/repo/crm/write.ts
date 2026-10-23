import type { DatabaseSync } from "node:sqlite";
import { getDb, type SavedLocationRow, type LocationStatus } from "@/lib/db";
import { canReachUser, canSeeBusiness, canWriteBusiness, isCrmManager, type Session } from "@/lib/session";
import { createTask } from "@/lib/repo/tasks";
import { emitEvent, type EventInput } from "@/lib/repo/events";
import { districtIdForPoint, groupForPoint } from "@/lib/groups";
import { OUTCOMES, type OutcomeCode } from "@/lib/crm/outcomes";
import { recomputeState } from "./state";
import { recordOwnerChange } from "./ownerChange";
import { resolveDue, type DueSpec } from "@/lib/crm/due";
import { nextOpenAt, parseHours } from "@/lib/crm/hours";
import { normPhone } from "@/lib/crm/phone";
import { normInstagram } from "@/lib/crm/social";
import { customerTypeFor, isDecider, isInvalid, type Verification } from "@/lib/crm/vocab";
import { FlowError, interpolate, replayAnswers } from "@/lib/crm/flows/machine";
import type { FlowAnswer, FlowConfig, FlowContext, FlowSet, FlowState } from "@/lib/crm/flows/types";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { addLeadFlow, basicsOf, hoursOf, linkOf, pinOf, type PinValue } from "@/lib/crm/flows/addLead";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import type { CustomerLifecycle } from "@/lib/types";
import { addLeadContext, flowContextFor, getBusiness } from "./businesses";
import { findDuplicates } from "./dedupe";
import { isVanRole } from "../../roles";

export class CrmError extends Error {
  /* Explicit fields rather than parameter properties — those are not erasable syntax, so
   * `node --experimental-strip-types` refuses the file. See the identical note in
   * lib/repo/crm/conversion.ts:8. */
  status: number;
  extra?: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** The business `id` as `session` may WRITE to it: 404 when it cannot see it at all (so a
 *  row outside the caller's scope does not announce that it exists), 403 when it can see but
 *  not write. The one guard every CRM mutation starts with. */
export function writableBusiness(session: Session, id: number) {
  const b = getBusiness(session, id);
  if (!b) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  if (!canWriteBusiness(session, b)) throw new CrmError(403, "دسترسی لازم را ندارید");
  return b;
}

export interface FlowWriteInput {
  customerId: number;
  answers: FlowAnswer[];
  entry: "call" | "talked_now";
  channel: "call" | "visit";
  taskId?: number | null;
  clientUuid?: string | null;
  nowIso?: string;
  /** Driver visits only: where the phone was when the driver saved. */
  driverPos?: { lat: number; lng: number; accuracy: number } | null;
}
export interface FlowWriteResult { customerId: number; activityId: number; nextTaskId: number | null; acc: FlowSet }

interface Core {
  id: number; organization_id: number; business_name: string; owner_user_id: number | null; group_id: number | null;
  phone_norm: string | null; attempt_count: number; next_task_id: number | null; lifecycle: CustomerLifecycle;
  temperature: string | null; temperature_manual: number; verification: string | null; sales_stage: string | null;
  working_hours_json: string | null;
}
const loadCore = (db: DatabaseSync, id: number): Core | undefined =>
  db.prepare(`SELECT id, organization_id, business_name, owner_user_id, group_id, phone_norm, COALESCE(attempt_count, 0) AS attempt_count,
                     next_task_id, lifecycle, temperature, COALESCE(temperature_manual, 0) AS temperature_manual, verification,
                     sales_stage, working_hours_json
                FROM customers WHERE id = ? AND merged_into_id IS NULL`).get(id) as unknown as Core | undefined;

interface ActivityInsert {
  customerId: number; userId: number | null; type: string; at: string;
  contactId?: number | null; outcome?: string | null; attemptNo?: number | null; phoneUsed?: string | null; note?: string | null;
  answers?: unknown; contact_status_to?: string | null; stage_to?: string | null; verification_to?: string | null; signal?: string | null;
  attempt?: boolean; miss?: boolean; talked?: boolean; completedTaskId?: number | null; nextTaskId?: number | null; clientUuid?: string | null;
}
function insertActivity(db: DatabaseSync, org: number, a: ActivityInsert): number {
  return Number(db.prepare(`INSERT INTO activities
      (organization_id, customer_id, user_id, contact_id, type, outcome_code, attempt_no, phone_used, note, answers_json,
       contact_status_to, stage_to, verification_to, signal, attempt, miss, talked, completed_task_id, next_task_id, client_uuid, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(org, a.customerId, a.userId, a.contactId ?? null, a.type, a.outcome ?? null, a.attemptNo ?? null, a.phoneUsed ?? null,
      a.note ?? null, a.answers === undefined ? null : JSON.stringify(a.answers), a.contact_status_to ?? null, a.stage_to ?? null,
      a.verification_to ?? null, a.signal ?? null, a.attempt ? 1 : 0, a.miss ? 1 : 0, a.talked ? 1 : 0,
      a.completedTaskId ?? null, a.nextTaskId ?? null, a.clientUuid ?? null, a.at, new Date().toISOString()).lastInsertRowid);
}

function setLocation(db: DatabaseSync, id: number, lat: number, lng: number, precision: "exact" | "approx"): void {
  db.prepare("UPDATE customers SET lat = ?, lng = ?, location_precision = ?, district_id = ? WHERE id = ?")
    .run(lat, lng, precision, districtIdForPoint(db, lat, lng), id);
}

function parsePin(v: string | undefined): PinValue | null {
  return pinOf(v ? { pin: v } : {});
}

/** The one open next action. Picked dates come from the last answer that carried one;
 *  the time is moved into the business's working hours. */
function openNextTask(session: Session, core: Core, acc: FlowSet, st: FlowState, ctx: FlowContext, at: string): number | null {
  if (!acc.due || acc.due.kind === "none") return null;
  const picked = [...st.answers].reverse().find((a) => a.value && /^\d{4}-\d{2}-\d{2}$/.test(a.value))?.value ?? null;
  const raw = resolveDue(acc.due, at, picked);
  if (!raw) throw new CrmError(400, "روز را انتخاب کنید");
  const due = nextOpenAt(parseHours(core.working_hours_json), raw);
  let assignee = core.owner_user_id;
  let roleHint: string | null = assignee ? null : "phone_sales";
  if (acc.next_assignee === "group_manager") { assignee = null; roleHint = "group_manager"; }
  if (acc.next_assignee === "driver_pool") { assignee = null; roleHint = "field_rep"; }
  return createTask(core.organization_id, {
    title: `${interpolate(acc.next_title ?? "پیگیری", ctx, acc)} · ${core.business_name}`,
    kind: acc.next_kind ?? "call",
    assignee_user_id: assignee,
    role_hint: roleHint,
    group_id: core.group_id,
    entity_type: "customer",
    entity_id: core.id,
    due_at: due,
    priority: core.temperature === "hot" || acc.outcome === "ASKED_PRICE" || acc.outcome === "REQUESTED_SAMPLE" || acc.outcome === "NEGOTIATING" ? "HIGH" : "NORMAL",
    created_by: session.user.id,
  });
}

function replayOr400(cfg: FlowConfig, ctx: FlowContext, answers: FlowAnswer[]): FlowState {
  let st: FlowState;
  try {
    st = replayAnswers(cfg, ctx, Array.isArray(answers) ? answers : []);
  } catch (e) {
    if (e instanceof FlowError) throw new CrmError(400, "پاسخ‌ها با پرسش‌ها جور نیست");
    throw e;
  }
  if (!st.saved) throw new CrmError(400, "پاسخ‌ها کامل نیست");
  return st;
}

const emitAll = (org: number, events: EventInput[]) => { for (const e of events) emitEvent(org, e); };

/** The contact this activity is with: an existing one named by the flow, or a new one created from its answers. */
function resolveContact(
  db: DatabaseSync, session: Session,
  c: { org: number; customerId: number; acc: FlowSet; st: FlowState; at: string },
): number | null {
  const { org, customerId, acc, st, at } = c;
  let contactId: number | null = null;
  if (acc.contact_id) {
    if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND customer_id = ?").get(acc.contact_id, customerId)) throw new CrmError(400, "مخاطب نامعتبر است");
    contactId = acc.contact_id;
  } else if (acc.contact_role) {
    const hasPrimary = !!db.prepare("SELECT 1 FROM contacts WHERE customer_id = ? AND is_primary = 1 AND active = 1").get(customerId);
    contactId = Number(db.prepare(`INSERT INTO contacts (organization_id, customer_id, name, role, is_primary, is_decider, created_by, created_at, updated_at)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(org, customerId, st.values.contact_name?.trim() || null, acc.contact_role, hasPrimary ? 0 : 1, isDecider(acc.contact_role) ? 1 : 0, session.user.id, at, at).lastInsertRowid);
  }

  return contactId;
}

/** What the visit changes on the business itself: phone, name, pin, and whether it is closed or lost. */
function applyCustomerUpdates(
  db: DatabaseSync,
  c: { customerId: number; at: string; acc: FlowSet; st: FlowState; newPhone: string | null; newName: string | undefined; contactId: number | null; driverPos: FlowWriteInput["driverPos"] },
): void {
  const { customerId, at, acc, st, newPhone, newName, contactId, driverPos: pos } = c;
  if (newPhone) {
    db.prepare("UPDATE customers SET phone = ?, phone_norm = ? WHERE id = ?").run(`0${newPhone}`, newPhone, customerId);
    if (contactId) db.prepare("UPDATE contacts SET phone = ?, phone_norm = ? WHERE id = ? AND phone_norm IS NULL").run(`0${newPhone}`, newPhone, contactId);
  }
  if (newName) db.prepare("UPDATE customers SET business_name = ? WHERE id = ?").run(newName, customerId);
  const moved = parsePin(st.values.movedpin);
  if (moved) setLocation(db, customerId, moved.lat, moved.lng, moved.precision);
  if (pos && acc.verification === "verified" && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) && pos.accuracy <= 60) setLocation(db, customerId, pos.lat, pos.lng, "exact");
  if (acc.invalid) db.prepare("UPDATE customers SET closed_at = ?, lost_reason_code = COALESCE(?, lost_reason_code) WHERE id = ?").run(at, acc.lost_reason ?? null, customerId);
  else if (acc.lost_reason) db.prepare("UPDATE customers SET lost_reason_code = ? WHERE id = ?").run(acc.lost_reason, customerId);
}

export function applyFlow(session: Session, input: FlowWriteInput): FlowWriteResult {
  const db = getDb();
  const core = loadCore(db, input.customerId);
  if (!core || !canSeeBusiness(session, core)) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  if (!canWriteBusiness(session, core)) throw new CrmError(403, "دسترسی لازم را ندارید");
  const fc = flowContextFor(session, core.id, input.entry)!;
  return applyFlowCore(session, afterCallFlow, fc.ctx, core.id, input, { claim: true });
}

/** Shared by applyFlow and the driver visit. The caller has already checked access. */
export function applyFlowCore(
  session: Session, cfg: FlowConfig, ctx: FlowContext, customerId: number, input: FlowWriteInput, opts: { claim: boolean }
): FlowWriteResult {
  const db = getDb();
  const core = loadCore(db, customerId);
  if (!core) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  const st = replayOr400(cfg, ctx, input.answers);
  const acc = st.acc;
  const at = input.nowIso ?? new Date().toISOString();
  const org = core.organization_id;

  if (input.clientUuid) {
    const dup = db.prepare("SELECT id, next_task_id FROM activities WHERE organization_id = ? AND client_uuid = ?").get(org, input.clientUuid) as
      { id: number; next_task_id: number | null } | undefined;
    if (dup) return { customerId, activityId: dup.id, nextTaskId: dup.next_task_id, acc };
  }

  const newPhone = normPhone(st.values.new_phone);
  if (st.values.new_phone && !newPhone) throw new CrmError(400, "شماره تلفن معتبر نیست");
  const events: EventInput[] = [];
  const base = { entity_type: "customer", entity_id: customerId, actor_user_id: session.user.id };

  db.exec("BEGIN IMMEDIATE");
  let activityId: number;
  let nextTaskId: number | null;
  try {
    let owner = core.owner_user_id;
    if (opts.claim && owner === null && session.role === "phone_sales") {
      db.prepare("UPDATE customers SET owner_user_id = ? WHERE id = ?").run(session.user.id, customerId);
      owner = session.user.id;
      recordOwnerChange(db, { organizationId: org, customerId, actorUserId: session.user.id, reason: "pool_claim", what: "owner", fromId: null, toId: session.user.id, at });
      events.push({ ...base, kind: "lead.claimed" });
    }

    const contactId = resolveContact(db, session, { org, customerId, acc, st, at });

    const newName = st.values.new_name?.trim();
    applyCustomerUpdates(db, { customerId, at, acc, st, newPhone, newName, contactId, driverPos: input.driverPos });

    const outcome: OutcomeCode | null = acc.outcome ?? (acc.contact_role ? "TALKED" : null);
    if (input.taskId) {
      db.prepare(`UPDATE tasks SET status = 'done', outcome_code = ?, done_at = ?
                   WHERE id = ? AND organization_id = ? AND entity_type = 'customer' AND entity_id = ? AND status = 'open'`)
        .run(outcome, at, input.taskId, org, customerId);
    }

    nextTaskId = acc.invalid ? null : openNextTask(session, { ...core, owner_user_id: owner, business_name: newName || core.business_name }, acc, st, ctx, at);
    if (core.next_task_id && core.next_task_id !== input.taskId) {
      db.prepare("UPDATE tasks SET status = 'dismissed' WHERE id = ? AND status = 'open'").run(core.next_task_id);
    }
    db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(nextTaskId, customerId);

    const o = outcome ? OUTCOMES[outcome] : null;
    activityId = insertActivity(db, org, {
      customerId, userId: session.user.id, contactId, type: input.channel, outcome,
      attemptNo: o?.attempt ? core.attempt_count + 1 : null, phoneUsed: input.channel === "call" ? core.phone_norm : null,
      answers: { answers: input.answers, skip: acc.skip_reason ?? null, product_id: acc.product_id ?? null, sample_qty: acc.sample_qty ?? null },
      contact_status_to: o?.contact_status ?? null, stage_to: o?.stage ?? null, verification_to: acc.verification ?? null, signal: o?.signal ?? null,
      attempt: !!o?.attempt, miss: !!o?.miss, talked: !!o?.talked, completedTaskId: input.taskId ?? null, nextTaskId,
      clientUuid: input.clientUuid ?? null, at,
    });
    recomputeState(db, customerId);

    const after = loadCore(db, customerId)!;
    events.push({ ...base, kind: "activity.logged", metadata: { activity_id: activityId, outcome, channel: input.channel } });
    if (after.verification !== core.verification && after.verification) {
      events.push({ ...base, kind: isInvalid(after.verification as Verification) ? "lead.invalidated" : "lead.verified", metadata: { from: core.verification, to: after.verification } });
    }
    if (after.sales_stage !== core.sales_stage) events.push({ ...base, kind: "stage.changed", metadata: { from: core.sales_stage, to: after.sales_stage } });
    if (after.temperature !== core.temperature) events.push({ ...base, kind: "temperature.changed", metadata: { from: core.temperature, to: after.temperature } });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  emitAll(org, events);
  return { customerId, activityId, nextTaskId, acc };
}

/** A driver's visit to a lead location (همه مکان‌ها). Unlike applyFlow this writes to
 *  saved_locations, not customers: a lead location is not yet a customer, and the two
 *  tables have different shapes (no phone, no lifecycle, three rating columns).
 *
 *  The flow's `acc` carries everything the row needs to know:
 *    - outcome  -> visit_outcome (the one-word record of what happened)
 *    - stars    -> rating_potential / volume / ease
 *    - handoff_sales -> the driver met someone interested but unreachable by phone;
 *                          create a call task for the group's sales team
 *    - next_kind / due / open_order -> a task for whoever acts next. A ready buyer sets
 *                          next_kind "order", so the office gets the paperwork even if the
 *                          driver never opens the order page; open_order additionally offers
 *                          that page to the driver, which is the same pair afterCall.ts uses.
 *
 *  There is deliberately no conversion here. A lead becomes a customer when it buys, and
 *  that happens in the order transaction, not in a visit record: the flow used to ask the
 *  driver "تبدیل به مشتری؟" and stash the answer in `convert_location`, which nothing ever
 *  read. The manual convert route still exists for the office.
 */
export function applyLeadVisit(
  session: Session,
  input: { locationId: number; answers: FlowAnswer[]; clientUuid?: string | null; nowIso?: string },
): { activityId: number; nextTaskId: number | null; acc: FlowSet } {
  const db = getDb();
  const at = input.nowIso ?? new Date().toISOString();
  const loc = db.prepare("SELECT * FROM saved_locations WHERE id = ?").get(input.locationId) as SavedLocationRow | undefined;
  // organization_id is nullable on the row type and every write below needs it as a number.
  // A pin with no organisation cannot be written to in a multi-tenant table at all, so it is
  // refused here rather than papered over with a cast further down.
  if (!loc || loc.organization_id === null) throw new CrmError(404, "مکان پیدا نشد");
  // And it must be the caller's company's: an id alone reaches every tenant's pins.
  if (session.role !== "platform_owner" && loc.organization_id !== session.organizationId) throw new CrmError(404, "مکان پیدا نشد");

  const ctx: FlowContext = {
    entry: "driver_visit",
    firstContact: true,
    attemptNo: 1,
    maxMisses: 5,
    isManager: !isVanRole(session.role),
    vars: { name: loc.name, address: loc.address ?? "" },
    knownContacts: [],
    products: [],
    reps: [],
    recentCustomers: [],
  };
  const st = replayOr400(leadVisitFlow, ctx, input.answers);
  const acc = st.acc;
  const org = loc.organization_id;

  if (input.clientUuid) {
    const dup = db.prepare("SELECT id FROM lead_visit_activities WHERE organization_id = ? AND location_id = ? AND client_uuid = ?")
      .get(org, input.locationId, input.clientUuid) as { id: number } | undefined;
    if (dup) return { activityId: dup.id, nextTaskId: null, acc };
  }

  const stars = acc.stars ?? {};
  const outcome = acc.outcome ?? null;
  const status = outcomeToStatus(outcome);

  db.exec("BEGIN IMMEDIATE");
  let activityId: number;
  let nextTaskId: number | null = null;
  try {
    db.prepare(`UPDATE saved_locations SET status = ?, visit_outcome = ?, rating_potential = ?, rating_volume = ?, rating_ease = ?, updated_at = ?
                 WHERE id = ? AND organization_id = ?`)
      .run(status, outcome, stars.potential ?? null, stars.volume ?? null, stars.ease ?? null, at, input.locationId, org);

    activityId = Number(db.prepare(`INSERT INTO lead_visit_activities
      (organization_id, location_id, user_id, outcome_code, answers_json, client_uuid, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(org, input.locationId, session.user.id, outcome, JSON.stringify({ answers: input.answers }), input.clientUuid ?? null, at).lastInsertRowid);

    // Reminder task (only when the driver said "yes + one day").
    if (acc.next_kind && acc.due) {
      nextTaskId = createTask(org, {
        title: acc.next_title ?? "یادآوری بازدید",
        kind: acc.next_kind,
        assignee_user_id: isVanRole(session.role) ? null : session.user.id,
        role_hint: isVanRole(session.role) ? "group_manager" : null,
        group_id: loc.group_id as unknown as number | undefined,
        entity_type: "lead_location",
        entity_id: input.locationId,
        due_at: resolveDueText(acc.due, at),
        priority: "NORMAL",
        created_by: session.user.id,
      });
    }
    // Handoff to sales: the driver met someone interested but unreachable by phone.
    else if (acc.handoff_sales) {
      nextTaskId = createTask(org, {
        title: `تماس با «${loc.name}» — علاقه‌مند ولی نیاز به تماس`,
        kind: "call",
        assignee_user_id: null,
        role_hint: "group_manager",
        group_id: loc.group_id as unknown as number | undefined,
        entity_type: "lead_location",
        entity_id: input.locationId,
        due_at: tomorrow10(at),
        priority: "HIGH",
        created_by: session.user.id,
      });
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { activityId, nextTaskId, acc };
}

/** Map a visit outcome to the saved_locations.status vocabulary. */
function outcomeToStatus(outcome: OutcomeCode | null): LocationStatus | null {
  switch (outcome) {
    case "VISITED": case "READY_TO_BUY": return "visited";
    case "ACCESS_FAILED": case "VISIT_CLOSED": case "VISIT_NO_OWNER": case "VISIT_WRONG_ADDRESS": case "VISIT_NEW_BUILDING": return "no_answer";
    case "VISIT_NOT_INTERESTED": return "declined";
    default: return null;
  }
}

/** Resolve a DueSpec to an ISO timestamp string, for the task's due_at. */
function resolveDueText(due: DueSpec, now: string): string {
  return resolveDue(due, now) ?? now;
}

function tomorrow10(now: string): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

const CRM_ROLES = new Set(["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales"]);

export function createLead(session: Session, input: { answers: FlowAnswer[]; clientUuid?: string | null; nowIso?: string }): { id: number; nextTaskId: number | null; acc: FlowSet } {
  if (!CRM_ROLES.has(session.role)) throw new CrmError(403, "دسترسی لازم را ندارید");
  const db = getDb();
  const at = input.nowIso ?? new Date().toISOString();
  const org = session.organizationId;
  const ctx = addLeadContext(session);
  const st = replayOr400(addLeadFlow, ctx, input.answers);
  const acc = st.acc;

  if (input.clientUuid) {
    const existing = db.prepare("SELECT id, next_task_id FROM customers WHERE organization_id = ? AND client_uuid = ?").get(org, input.clientUuid) as
      { id: number; next_task_id: number | null } | undefined;
    if (existing) return { id: existing.id, nextTaskId: existing.next_task_id, acc };
  }

  const basics = basicsOf(st.values);
  const name = basics?.name.trim() ?? "";
  if (name.length < 2) throw new CrmError(400, "نام کسب‌وکار لازم است");
  const pin = pinOf(st.values);
  if (!pin) throw new CrmError(422, "مکان کسب‌وکار لازم است");
  const phone = normPhone(basics?.phone);
  if (basics?.phone?.trim() && !phone) throw new CrmError(400, "شماره تلفن معتبر نیست");
  if (basics?.instagram != null && typeof basics.instagram !== "string") throw new CrmError(400, "آدرس صفحهٔ اینستاگرام معتبر نیست");
  const instagram = normInstagram(basics?.instagram);
  if (basics?.instagram?.trim() && !instagram) throw new CrmError(400, "آدرس صفحهٔ اینستاگرام معتبر نیست");
  if (instagram) {
    // A chain's branches often share one page, so a declared branch passes here too.
    const igMatches = findDuplicates(session, { instagram }).filter((m) => m.kind === "instagram");
    const branchOk = basics?.branch_of != null && igMatches.some((m) => m.reachable && m.id === basics.branch_of);
    if (igMatches.length && !branchOk) throw new CrmError(409, "این صفحهٔ اینستاگرام قبلاً ثبت شده است", { matches: igMatches });
  }
  if (phone) {
    const matches = findDuplicates(session, { phone }).filter((m) => m.kind === "phone");
    const branchOk = basics?.branch_of != null && matches.some((m) => m.reachable && m.id === basics.branch_of);
    if (matches.length && !branchOk) throw new CrmError(409, "این شماره قبلاً ثبت شده است", { matches });
  }

  let owner: number | null = session.user.id;
  if (isCrmManager(session.role)) {
    if (acc.owner === "pool") owner = null;
    else if (typeof acc.owner === "number") {
      const u = db.prepare("SELECT role FROM users WHERE id = ? AND organization_id = ? AND active = 1").get(acc.owner, org) as { role: string } | undefined;
      if (!u || u.role !== "phone_sales" || !canReachUser(session, acc.owner)) throw new CrmError(400, "فروشنده نامعتبر است");
      owner = acc.owner;
    }
  }
  const groupId = session.role === "phone_sales" ? session.groupId : groupForPoint(db, pin.lat, pin.lng, session.organizationId) ?? session.groupId;
  const districtId = districtIdForPoint(db, pin.lat, pin.lng);
  const area = districtId ? (db.prepare("SELECT name FROM districts WHERE id = ?").get(districtId) as { name: string } | undefined)?.name ?? null : null;
  const link = linkOf(st.values);
  const hours = hoursOf(st.values);
  const referred = acc.referred_by && getBusiness(session, acc.referred_by) ? acc.referred_by : null;
  const businessType = acc.business_type ?? "OTHER";
  const verification: Verification = acc.verification ?? "unverified";
  const events: EventInput[] = [];

  db.exec("BEGIN IMMEDIATE");
  let id: number;
  let nextTaskId: number | null;
  try {
    const code = `CRM-${at.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
    id = Number(db.prepare(`INSERT INTO customers
        (customer_code, business_name, phone, phone_norm, instagram, address, area_label, lat, lng, location_precision, district_id, maps_url,
         source_code, source_detail, source_url, referred_by_customer_id, parent_customer_id, business_type, customer_type, price_tier,
         working_hours_json, owner_user_id, group_id, lifecycle, verification, contact_status, sales_stage, temperature, client_uuid,
         synced_at, organization_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, 'not_contacted', 'unknown', 'cold', ?, ?, ?)`)
      .run(code, name, phone ? `0${phone}` : null, phone, instagram, pin.address ?? link?.address ?? null, area, pin.lat, pin.lng, pin.precision,
        districtId, link?.maps_url ?? null, acc.source ?? "OTHER", st.values.source_detail?.trim() || null, link?.maps_url ?? null,
        referred, basics?.branch_of ?? null, businessType, customerTypeFor(businessType), acc.price_tier ?? "unknown",
        hours.length ? JSON.stringify(hours) : null, owner, groupId, verification, input.clientUuid ?? null, at, org).lastInsertRowid);

    insertActivity(db, org, { customerId: id, userId: session.user.id, type: "lead_created", verification_to: verification, answers: { answers: input.answers }, at });
    const core = loadCore(db, id)!;
    nextTaskId = openNextTask(session, core, acc, st, { ...ctx, vars: { name } }, at);
    db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(nextTaskId, id);
    recomputeState(db, id);
    events.push({ kind: "lead.created", entity_type: "customer", entity_id: id, actor_user_id: session.user.id, metadata: { source: acc.source ?? null } });
    if (verification === "verified") events.push({ kind: "lead.verified", entity_type: "customer", entity_id: id, actor_user_id: session.user.id });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  emitAll(org, events);
  return { id, nextTaskId, acc };
}

export function claimBusiness(session: Session, id: number): void {
  const db = getDb();
  const core = loadCore(db, id);
  if (!core || !canSeeBusiness(session, core)) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  if (session.role !== "phone_sales" || core.owner_user_id !== null) throw new CrmError(409, "این کسب‌وکار صاحب دارد");
  const at = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE customers SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL").run(session.user.id, id);
    recordOwnerChange(db, { organizationId: core.organization_id, customerId: id, actorUserId: session.user.id, reason: "pool_claim", what: "owner", fromId: null, toId: session.user.id, at });
    if (core.next_task_id) db.prepare("UPDATE tasks SET assignee_user_id = ? WHERE id = ? AND status = 'open' AND assignee_user_id IS NULL").run(session.user.id, core.next_task_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  emitEvent(core.organization_id, { kind: "lead.claimed", entity_type: "customer", entity_id: id, actor_user_id: session.user.id });
}

/** A rep found a phone that belongs to a business they cannot see: ask its group's manager. */
export function requestReassign(session: Session, phoneRaw: string): { taskId: number } {
  const phone = normPhone(phoneRaw);
  if (!phone) throw new CrmError(400, "شماره تلفن معتبر نیست");
  const db = getDb();
  const target = db.prepare("SELECT id, business_name, group_id FROM customers WHERE organization_id = ? AND phone_norm = ? AND merged_into_id IS NULL LIMIT 1")
    .get(session.organizationId, phone) as { id: number; business_name: string; group_id: number | null } | undefined;
  if (!target) throw new CrmError(404, "کسب‌وکاری با این شماره پیدا نشد");
  const taskId = createTask(session.organizationId, {
    title: `درخواست واگذاری «${target.business_name}» به ${session.user.display_name}`,
    kind: "outreach", role_hint: "group_manager", group_id: target.group_id, entity_type: "customer", entity_id: target.id,
    due_at: new Date().toISOString(), priority: "NORMAL", created_by: session.user.id,
  });
  emitEvent(session.organizationId, { kind: "reassign.requested", entity_type: "customer", entity_id: target.id, actor_user_id: session.user.id });
  return { taskId };
}
